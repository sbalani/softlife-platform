import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "../supabase/server";
import {
  buildFiscalPreflightItem,
  evaluateFiscalConfiguration,
  summarizeFiscalPreflight,
  currentSupportingSaleOrderSourceHash,
  type FiscalConfigurationEvaluation,
  type FiscalFinding,
  type FiscalPreflightItem,
  type FiscalProductCheck,
  type FiscalRecipe,
  type FiscalSettings,
} from "../odoo-fiscal-preflight.ts";
import { sha256 } from "../odoo-sync-contract.ts";
import { closedFiscalMonth, FISCAL_V2_CUTOVER_DATE } from "../odoo-fiscal-invoices.ts";

export type FiscalPreflightAdminData = {
  available: boolean;
  settings: (FiscalSettings & { updated_at: string }) | null;
  configuration: {
    id: string;
    checked_at: string;
    accepted: boolean;
    findings: FiscalFinding[];
    payload_sha256: string;
  } | null;
  runs: {
    id: string;
    status: "ready" | "blocked";
    period_from: string;
    period_to: string;
    time_zone: string;
    tax_rate: number;
    currency: string;
    global_findings: FiscalFinding[];
    summary: ReturnType<typeof summarizeFiscalPreflight>;
    created_at: string;
  }[];
  selectedRun: FiscalPreflightAdminData["runs"][number] | null;
  selectedItems: FiscalPreflightItem[];
  selectionError: string | null;
};

const EMPTY: FiscalPreflightAdminData = { available: false, settings: null, configuration: null, runs: [], selectedRun: null, selectedItems: [], selectionError: null };

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function fiscalSettings(row: Record<string, unknown>): FiscalSettings & { updated_at: string } {
  return {
    journal_code: String(row.journal_code),
    customer_odoo_id: Number(row.customer_odoo_id),
    vat_rate: Number(row.vat_rate),
    currency: String(row.currency),
    income_account_code: String(row.income_account_code),
    tax_treatment_approved: Boolean(row.tax_treatment_approved),
    posting_enabled: Boolean(row.posting_enabled),
    updated_at: String(row.updated_at),
  };
}

async function getSettings(s: SupabaseClient) {
  const { data, error } = await s.from("odoo_fiscal_settings").select("*").eq("singleton", true).single();
  if (error) throw error;
  return fiscalSettings(data as Record<string, unknown>);
}

async function getLatestConfiguration(s: SupabaseClient) {
  const { data, error } = await s.from("odoo_fiscal_configuration_reports")
    .select("id,checked_at,accepted,findings,payload,payload_sha256,created_at")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function getFiscalConfigurationRequest(s: SupabaseClient) {
  const settings = await getSettings(s);
  return {
    contract_version: 1,
    expected: {
      journal_code: settings.journal_code,
      customer_odoo_id: settings.customer_odoo_id,
      vat_rate: settings.vat_rate,
      currency: settings.currency,
      income_account_code: settings.income_account_code,
      tax_treatment_approved: settings.tax_treatment_approved,
      posting_enabled: settings.posting_enabled,
    },
    required_capabilities: {
      fiscal_invoice_draft_creation: 1,
      fiscal_invoice_bulk_confirmation: 1,
      fiscal_zero_value_invoices: 2,
      fiscal_invoice_allocation_v2: 1,
      manufacturing_transaction_sales: 1,
    },
    required_product_fields: ["odoo_product_id", "sale_ok", "income_account_code", "sale_taxes"],
  };
}

export async function recordFiscalConfiguration(s: SupabaseClient, body: Record<string, unknown>) {
  const settings = await getSettings(s);
  const evaluation = evaluateFiscalConfiguration(settings, body);
  const payloadSha256 = sha256(body);
  const { data, error } = await s.from("odoo_fiscal_configuration_reports").insert({
    contract_version: 1,
    checked_at: evaluation.checkedAt || new Date(0).toISOString(),
    accepted: evaluation.accepted,
    findings: evaluation.findings,
    payload: body,
    payload_sha256: payloadSha256,
  }).select("id").single();
  if (error) throw error;
  return { report_id: data.id, accepted: evaluation.accepted, findings: evaluation.findings, payload_sha256: payloadSha256 };
}

async function fetchOrders(s: SupabaseClient, periodFrom: string, periodTo: string) {
  const result: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await s.from("huaxin_orders")
      .select("id,order_code,out_trade_no,order_state,status_code,order_time,pay_time,price,nums,product_name,products,pay_type_raw,refund_status,refund_out_no,currency,machine_id,device_imei,export_content_hash,machines(name)")
      .or(`and(order_time.gte.${periodFrom},order_time.lt.${periodTo}),and(order_time.is.null,pay_time.gte.${periodFrom},pay_time.lt.${periodTo})`)
      .order("order_time").order("id").range(offset, offset + 999);
    if (error) throw error;
    result.push(...((data as Record<string, unknown>[]) ?? []));
    if (!data || data.length < 1000) return result;
  }
}

async function countPaymentReferences(s: SupabaseClient, references: string[]) {
  const counts = new Map<string, number>();
  for (let offset = 0; offset < references.length; offset += 200) {
    const { data, error } = await s.from("huaxin_orders").select("out_trade_no").in("out_trade_no", references.slice(offset, offset + 200));
    if (error) throw error;
    for (const row of data ?? []) {
      const reference = String(row.out_trade_no ?? "").trim();
      if (reference) counts.set(reference, (counts.get(reference) ?? 0) + 1);
    }
  }
  return counts;
}

async function fetchResolutions(s: SupabaseClient, orderIds: string[]) {
  const result: Record<string, unknown>[] = [];
  for (let offset = 0; offset < orderIds.length; offset += 200) {
    const { data, error } = await s.from("order_product_resolutions")
      .select("order_id,line_index,raw_name,raw_position,recipe_id,resolution_status,mapping_method,problem_code")
      .in("order_id", orderIds.slice(offset, offset + 200)).order("line_index");
    if (error) throw error;
    result.push(...((data as Record<string, unknown>[]) ?? []));
  }
  return result;
}

async function fetchRecipes(s: SupabaseClient, recipeIds: string[]) {
  if (!recipeIds.length) return new Map<string, FiscalRecipe>();
  const result = new Map<string, FiscalRecipe>();
  for (let offset = 0; offset < recipeIds.length; offset += 200) {
    const { data, error } = await s.from("recipes").select("id,name,odoo_finished_product_id,active")
      .in("id", recipeIds.slice(offset, offset + 200)).eq("active", true);
    if (error) throw error;
    for (const row of data ?? []) result.set(String(row.id), {
      id: String(row.id), name: String(row.name),
      odoo_finished_product_id: row.odoo_finished_product_id == null ? null : Number(row.odoo_finished_product_id),
    });
  }
  return result;
}

function productsFromEvaluation(evaluation: FiscalConfigurationEvaluation | null) {
  return evaluation ? new Map<number, FiscalProductCheck>(evaluation.products.map((product) => [product.odoo_product_id, product])) : null;
}

export async function createFiscalPreflight(s: SupabaseClient, input: {
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  requestedBy: string;
}) {
  const localDate = (value: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
  const localFrom = localDate(input.periodFrom);
  const localTo = localDate(input.periodTo);
  const isV2 = localFrom >= FISCAL_V2_CUTOVER_DATE;
  const fiscalMonth = isV2 ? closedFiscalMonth(input.periodFrom, input.periodTo, input.timeZone) : null;
  if (isV2 && !fiscalMonth) throw new Error("Post-cutover fiscal preflight requires one full closed Europe/Madrid calendar month.");
  if (!isV2 && localTo > FISCAL_V2_CUTOVER_DATE) throw new Error("A fiscal preflight cannot cross the September 2026 cutover.");
  const [settings, configuration, orders] = await Promise.all([
    getSettings(s), getLatestConfiguration(s), fetchOrders(s, input.periodFrom, input.periodTo),
  ]);
  const resolutions = await fetchResolutions(s, orders.map((order) => String(order.id)));
  const resolutionsByOrder = new Map<string, Record<string, unknown>[]>();
  for (const resolution of resolutions) {
    const orderRows = resolutionsByOrder.get(String(resolution.order_id)) ?? [];
    orderRows.push(resolution);
    resolutionsByOrder.set(String(resolution.order_id), orderRows);
  }
  const recipeIds = [...new Set(resolutions.map((resolution) => String(resolution.recipe_id ?? "")).filter(Boolean))];
  const recipes = await fetchRecipes(s, recipeIds);
  const paymentReferences = [...new Set(orders.map((order) => String(order.out_trade_no ?? "").trim()).filter(Boolean))];
  const paymentCounts = await countPaymentReferences(s, paymentReferences);
  const orderIds = orders.map((order) => String(order.id));
  const [requestsResult, supportingResult] = isV2 && orderIds.length ? await Promise.all([
    s.from("customer_invoice_requests").select("id,source_order_id,fiscal_details,fiscal_details_sha256").in("source_order_id", orderIds),
    s.from("manufacturing_sale_order_documents").select("id,source_order_id,source_sha256").in("source_order_id", orderIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (requestsResult.error) throw requestsResult.error;
  if (supportingResult.error) throw supportingResult.error;
  const requestsByOrder = new Map(((requestsResult.data as Record<string, unknown>[]) ?? []).map((row) => [String(row.source_order_id), row]));
  const supportingByOrder = new Map(((supportingResult.data as Record<string, unknown>[]) ?? []).map((row) => [String(row.source_order_id), row]));

  let configurationEvaluation: FiscalConfigurationEvaluation | null = null;
  const globalFindings: FiscalFinding[] = [];
  if (!configuration) {
    globalFindings.push({ severity: "blocker", code: "odoo_configuration_not_reported", message: "The Odoo connector has not reported the fiscal journal, customer, tax, company, and finished-product configuration." });
  } else {
    configurationEvaluation = evaluateFiscalConfiguration(settings, configuration.payload as Record<string, unknown>);
    globalFindings.push(...configurationEvaluation.findings);
    const capabilities = (configuration.payload as Record<string, unknown>).capabilities as Record<string, unknown> | undefined;
    if (isV2 && (Number(capabilities?.fiscal_invoice_allocation_v2) !== 1 || Number(capabilities?.manufacturing_transaction_sales) !== 1)) {
      globalFindings.push({ severity: "blocker", code: "fiscal_v2_capabilities_missing", message: "Odoo must advertise fiscal invoice allocation and manufacturing transaction-sales capabilities version 1 for post-cutover months." });
    }
    if (Date.now() - Date.parse(String(configuration.checked_at)) > 24 * 60 * 60_000) {
      globalFindings.push({ severity: "warning", code: "odoo_configuration_stale", message: "The Odoo fiscal configuration check is more than 24 hours old. Review its age before execution." });
    }
  }
  if (!settings.tax_treatment_approved) globalFindings.push({ severity: "blocker", code: "tax_treatment_not_approved", message: `An accountant must approve the ${settings.vat_rate}% vending sales tax treatment before this preflight can be ready.` });
  if (!settings.posting_enabled) globalFindings.push({ severity: "info", code: "posting_disabled", message: "The legacy posting switch remains disabled. Invoice confirmation requires the separate explicit fiscal confirmation workflow." });

  const verifiedProducts = configurationEvaluation?.accepted ? productsFromEvaluation(configurationEvaluation) : null;
  const items = orders.map((order) => {
    const paymentReference = String(order.out_trade_no ?? "").trim();
    const item = buildFiscalPreflightItem({
      order,
      resolutions: resolutionsByOrder.get(String(order.id)) ?? [],
      recipes,
      settings,
      timeZone: input.timeZone,
      duplicatePaymentReference: Boolean(paymentReference && (paymentCounts.get(paymentReference) ?? 0) > 1),
      verifiedProducts,
      contractVersion: isV2 ? 2 : 1,
    });
    if (!isV2 || item.status !== "eligible") return item;
    const request = requestsByOrder.get(item.order_id);
    const support = supportingByOrder.get(item.order_id);
    const supportingSourceHash = currentSupportingSaleOrderSourceHash(order.export_content_hash, support?.source_sha256);
    if (!support || !supportingSourceHash) {
      return { ...item, status: "blocked" as const, findings: [...item.findings, {
        severity: "blocker" as const, code: support ? "supporting_sale_order_stale" : "supporting_sale_order_missing",
        message: support
          ? "The transaction changed after its manufacturing v3 supporting sales-order mapping was frozen."
          : "The transaction has no completed manufacturing v3 supporting sales-order mapping.",
      }] };
    }
    return {
      ...item,
      invoice_mode: request ? "individual_requested" as const : "monthly_consolidated" as const,
      invoice_request_id: request ? String(request.id) : null,
      customer_fiscal_details: request ? request.fiscal_details as Record<string, unknown> : null,
      customer_fiscal_details_sha256: request ? String(request.fiscal_details_sha256) : null,
      supporting_sale_order_id: String(support.id),
      supporting_sale_order_source_sha256: supportingSourceHash,
    };
  });
  const summary = summarizeFiscalPreflight(items);
  const settingsSnapshot = {
    journal_code: settings.journal_code,
    customer_odoo_id: settings.customer_odoo_id,
    vat_rate: settings.vat_rate,
    currency: settings.currency,
    income_account_code: settings.income_account_code,
    tax_treatment_approved: settings.tax_treatment_approved,
    posting_enabled: settings.posting_enabled,
    updated_at: settings.updated_at,
  };
  const { data, error } = await s.rpc(isV2 ? "create_fiscal_preflight_v2" : "create_fiscal_preflight", {
    p_period_from: input.periodFrom,
    p_period_to: input.periodTo,
    p_time_zone: input.timeZone,
    p_tax_rate: settings.vat_rate,
    p_currency: settings.currency,
    p_configuration_report_id: configuration?.id ?? null,
    p_settings_snapshot: settingsSnapshot,
    p_global_findings: globalFindings,
    p_summary: summary,
    p_requested_by: input.requestedBy,
    p_items: items,
  });
  if (error) throw error;
  return { run_id: String(data), summary, global_findings: globalFindings };
}

function presentItem(row: Record<string, unknown>): FiscalPreflightItem {
  return {
    order_id: String(row.order_id), status: row.status as FiscalPreflightItem["status"],
    operation_at: row.operation_at == null ? null : String(row.operation_at),
    operation_local_date: row.operation_local_date == null ? null : String(row.operation_local_date),
    order_code: String(row.order_code), payment_reference: row.payment_reference == null ? null : String(row.payment_reference),
    description: row.description == null ? null : String(row.description), units: row.units == null ? null : Number(row.units),
    gross_cents: row.gross_cents == null ? null : Number(row.gross_cents), tax_base_cents: row.tax_base_cents == null ? null : Number(row.tax_base_cents),
    vat_cents: row.vat_cents == null ? null : Number(row.vat_cents), recipe_id: row.recipe_id == null ? null : String(row.recipe_id),
    odoo_product_id: row.odoo_product_id == null ? null : Number(row.odoo_product_id), refund_required: Boolean(row.refund_required),
    refund_reference: row.refund_reference == null ? null : String(row.refund_reference), findings: rows(row.findings) as FiscalFinding[],
    source_snapshot: row.source_snapshot as Record<string, unknown>, source_sha256: String(row.source_sha256),
    invoice_mode: row.invoice_mode == null ? null : row.invoice_mode as FiscalPreflightItem["invoice_mode"],
    invoice_request_id: row.invoice_request_id == null ? null : String(row.invoice_request_id),
    customer_fiscal_details: row.customer_fiscal_details == null ? null : row.customer_fiscal_details as Record<string, unknown>,
    customer_fiscal_details_sha256: row.customer_fiscal_details_sha256 == null ? null : String(row.customer_fiscal_details_sha256),
    supporting_sale_order_id: row.supporting_sale_order_id == null ? null : String(row.supporting_sale_order_id),
    supporting_sale_order_source_sha256: row.supporting_sale_order_source_sha256 == null ? null : String(row.supporting_sale_order_source_sha256),
  };
}

function presentRun(run: Record<string, unknown>): FiscalPreflightAdminData["runs"][number] {
  return {
    id: String(run.id), status: run.status as "ready" | "blocked", period_from: String(run.period_from), period_to: String(run.period_to),
    time_zone: String(run.time_zone), tax_rate: Number(run.tax_rate), currency: String(run.currency),
    global_findings: rows(run.global_findings) as FiscalFinding[],
    summary: run.summary as ReturnType<typeof summarizeFiscalPreflight>, created_at: String(run.created_at),
  };
}

export async function getFiscalPreflightAdminData(selectedRunId?: string): Promise<FiscalPreflightAdminData> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return EMPTY;
  try {
    const s = await createServiceClient();
    const runColumns = "id,status,period_from,period_to,time_zone,tax_rate,currency,global_findings,summary,created_at";
    const selectionRequested = selectedRunId != null && selectedRunId !== "";
    const selectionValid = selectedRunId != null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedRunId);
    const [settings, configuration, runsResult, selectedResult] = await Promise.all([
      getSettings(s), getLatestConfiguration(s),
      s.from("fiscal_preflight_runs").select(runColumns)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20),
      selectionValid
        ? s.from("fiscal_preflight_runs").select(runColumns).eq("id", selectedRunId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (runsResult.error) throw runsResult.error;
    if (selectedResult.error) throw selectedResult.error;
    const runRows = (runsResult.data as Record<string, unknown>[]) ?? [];
    const requestedRow = selectedResult.data as Record<string, unknown> | null;
    const selectedRow = selectionRequested ? requestedRow : runRows[0] ?? null;
    const selectionError = selectionRequested && !selectedRow
      ? selectionValid ? "The selected frozen run no longer exists." : "The selected frozen run ID is invalid."
      : null;
    const visibleRows = selectedRow && !runRows.some((run) => String(run.id) === String(selectedRow.id))
      ? [selectedRow, ...runRows]
      : runRows;
    const selectedId = selectedRow?.id == null ? null : String(selectedRow.id);
    const itemsResult = selectedId
      ? await s.from("fiscal_preflight_items").select("*").eq("run_id", selectedId).order("operation_at").order("order_id").limit(1000)
      : { data: [], error: null };
    if (itemsResult.error) throw itemsResult.error;
    return {
      available: true,
      settings,
      configuration: configuration ? {
        id: String(configuration.id), checked_at: String(configuration.checked_at), accepted: Boolean(configuration.accepted),
        findings: rows(configuration.findings) as FiscalFinding[], payload_sha256: String(configuration.payload_sha256),
      } : null,
      runs: visibleRows.map(presentRun),
      selectedRun: selectedRow ? presentRun(selectedRow) : null,
      selectedItems: ((itemsResult.data as Record<string, unknown>[]) ?? []).map(presentItem),
      selectionError,
    };
  } catch {
    return EMPTY;
  }
}
