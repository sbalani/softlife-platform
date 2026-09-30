import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "../supabase/server";
import {
  buildFiscalPreflightItem,
  evaluateFiscalConfiguration,
  summarizeFiscalPreflight,
  type FiscalConfigurationEvaluation,
  type FiscalFinding,
  type FiscalPreflightItem,
  type FiscalProductCheck,
  type FiscalRecipe,
  type FiscalSettings,
} from "../odoo-fiscal-preflight.ts";
import { sha256 } from "../odoo-sync-contract.ts";

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
  latestReady: FiscalPreflightAdminData["runs"][number] | null;
  latestItems: FiscalPreflightItem[];
};

const EMPTY: FiscalPreflightAdminData = { available: false, settings: null, configuration: null, runs: [], latestReady: null, latestItems: [] };

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
      fiscal_zero_value_invoices: 1,
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
      .select("id,order_code,out_trade_no,order_state,status_code,order_time,pay_time,price,nums,product_name,products,pay_type_raw,refund_status,refund_out_no,currency,machine_id,device_imei,machines(name)")
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

  let configurationEvaluation: FiscalConfigurationEvaluation | null = null;
  const globalFindings: FiscalFinding[] = [];
  if (!configuration) {
    globalFindings.push({ severity: "blocker", code: "odoo_configuration_not_reported", message: "The Odoo connector has not reported the fiscal journal, customer, tax, company, and finished-product configuration." });
  } else {
    configurationEvaluation = evaluateFiscalConfiguration(settings, configuration.payload as Record<string, unknown>);
    globalFindings.push(...configurationEvaluation.findings);
    if (Date.now() - Date.parse(String(configuration.checked_at)) > 24 * 60 * 60_000) {
      globalFindings.push({ severity: "blocker", code: "odoo_configuration_stale", message: "The latest Odoo fiscal configuration check is more than 24 hours old." });
    }
  }
  if (!settings.tax_treatment_approved) globalFindings.push({ severity: "blocker", code: "tax_treatment_not_approved", message: `An accountant must approve the ${settings.vat_rate}% vending sales tax treatment before this preflight can be ready.` });
  if (!settings.posting_enabled) globalFindings.push({ severity: "info", code: "posting_disabled", message: "The legacy posting switch remains disabled. Invoice confirmation requires the separate explicit fiscal confirmation workflow." });

  const verifiedProducts = configurationEvaluation?.accepted ? productsFromEvaluation(configurationEvaluation) : null;
  const items = orders.map((order) => {
    const paymentReference = String(order.out_trade_no ?? "").trim();
    return buildFiscalPreflightItem({
      order,
      resolutions: resolutionsByOrder.get(String(order.id)) ?? [],
      recipes,
      settings,
      timeZone: input.timeZone,
      duplicatePaymentReference: Boolean(paymentReference && (paymentCounts.get(paymentReference) ?? 0) > 1),
      verifiedProducts,
    });
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
  const { data, error } = await s.rpc("create_fiscal_preflight", {
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

export async function getFiscalPreflightAdminData(): Promise<FiscalPreflightAdminData> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return EMPTY;
  try {
    const s = await createServiceClient();
    const runColumns = "id,status,period_from,period_to,time_zone,tax_rate,currency,global_findings,summary,created_at";
    const [settings, configuration, runsResult, readyResult] = await Promise.all([
      getSettings(s), getLatestConfiguration(s),
      s.from("fiscal_preflight_runs").select(runColumns)
        .order("created_at", { ascending: false }).limit(20),
      s.from("fiscal_preflight_runs").select(runColumns).eq("status", "ready")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (runsResult.error) throw runsResult.error;
    if (readyResult.error) throw readyResult.error;
    const runRows = (runsResult.data as Record<string, unknown>[]) ?? [];
    const latestId = runRows[0]?.id == null ? null : String(runRows[0].id);
    const itemsResult = latestId
      ? await s.from("fiscal_preflight_items").select("*").eq("run_id", latestId).order("operation_at").order("order_id").limit(1000)
      : { data: [], error: null };
    if (itemsResult.error) throw itemsResult.error;
    return {
      available: true,
      settings,
      configuration: configuration ? {
        id: String(configuration.id), checked_at: String(configuration.checked_at), accepted: Boolean(configuration.accepted),
        findings: rows(configuration.findings) as FiscalFinding[], payload_sha256: String(configuration.payload_sha256),
      } : null,
      runs: runRows.map(presentRun),
      latestReady: readyResult.data ? presentRun(readyResult.data as Record<string, unknown>) : null,
      latestItems: ((itemsResult.data as Record<string, unknown>[]) ?? []).map(presentItem),
    };
  } catch {
    return EMPTY;
  }
}
