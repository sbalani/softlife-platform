import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "../supabase/server";
import {
  buildFiscalInvoiceDraftBatches,
  buildFiscalInvoiceDraftPayloadV2,
  closedFiscalMonth,
  fiscalV2WholeMonthBlocker,
  fiscalCalendarMonth,
  isFiscalCalendarMonth,
  type FiscalCalendarSpan,
  type FiscalInvoiceSourceItem,
  type FiscalInvoiceSourceItemV2,
} from "../odoo-fiscal-invoices.ts";
import { currentSupportingSaleOrderSourceHash, zeroValueVendReason } from "../odoo-fiscal-preflight.ts";
import { sha256 } from "../odoo-sync-contract.ts";

export type FiscalInvoiceDocumentAdmin = {
  id: string;
  batch_id: string;
  invoice_date: string;
  order_code: string;
  reference: string;
  currency: string;
  gross_cents: number;
  tax_base_cents: number;
  vat_cents: number;
  status: string;
  odoo_move_id: number | null;
  odoo_state: string | null;
  odoo_name: string | null;
  invoice_payload_sha256: string;
  contract_version: number;
  invoice_mode: string | null;
};

export type FiscalInvoiceBatchAdmin = FiscalCalendarSpan & {
  job_id: string;
  batch_sequence: number;
  preflight_run_id: string;
  period_from: string;
  period_to: string;
  payload_sha256: string;
  requested_at: string;
  draft_completed_at: string | null;
  completed_at: string | null;
  error: string | null;
  execution_decisions: {
    queued_invoiceable?: number;
    skipped_blocked?: number;
    skipped_excluded?: number;
    skipped_refund_review?: number;
    configuration_report_checked_at?: string;
    configuration_report_stale_at_execution?: boolean;
  };
};

export type FiscalInvoiceJobAdmin = FiscalCalendarSpan & {
  preflight_run_id: string;
  requested_at: string;
  completed_at: string | null;
  error: string | null;
  execution_decisions: FiscalInvoiceBatchAdmin["execution_decisions"];
  document_count: number;
  draft_count: number;
  posted_count: number;
  gross_cents: number;
  internal_batch_count: number;
  completed_internal_batch_count: number;
};

export type FiscalInvoiceAdminData = {
  available: boolean;
  jobs: FiscalInvoiceJobAdmin[];
  batches: FiscalInvoiceBatchAdmin[];
  documents: FiscalInvoiceDocumentAdmin[];
};

export type FiscalInvoiceQueuePreview = {
  runId: string;
  queueable: boolean;
  blockers: string[];
  warnings: string[];
  invoiceCount: number;
  skippedBlocked: number;
  skippedExcluded: number;
  skippedRefundReview: number;
  internalBatchCount: number;
  internalBatchSizes: number[];
};

const EMPTY: FiscalInvoiceAdminData = { available: false, jobs: [], batches: [], documents: [] };
const DOCUMENT_COLUMNS = "id,batch_id,invoice_date,order_code,reference,currency,gross_cents,tax_base_cents,vat_cents,status,odoo_move_id,odoo_state,odoo_name,invoice_payload_sha256,contract_version,invoice_mode";

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

function throwFiscalQueueError(error: { code?: string; message?: string }): never {
  if (error.code === "23P01") throw new Error("This period overlaps an existing non-cancelled fiscal invoice batch.");
  if (error.code === "23505") throw new Error("The fiscal invoice request conflicts with an existing source order, Odoo move, or active queue request.");
  throw error;
}

async function loadAdminDocuments(s: SupabaseClient, batchIds: string[]) {
  const documents: Record<string, unknown>[] = [];
  for (let batchOffset = 0; batchOffset < batchIds.length; batchOffset += 50) {
    for (let rowOffset = 0; documents.length < 1000; rowOffset += 1000) {
      const remaining = 1000 - documents.length;
      const result = await s.from("fiscal_invoice_documents").select(DOCUMENT_COLUMNS)
        .in("batch_id", batchIds.slice(batchOffset, batchOffset + 50)).order("invoice_date", { ascending: false }).order("id").range(rowOffset, rowOffset + remaining - 1);
      if (result.error) throw result.error;
      const page = records(result.data);
      documents.push(...page);
      if (page.length < remaining) break;
    }
    if (documents.length >= 1000) break;
  }
  return documents.sort((left, right) => String(right.invoice_date).localeCompare(String(left.invoice_date)) || String(left.id).localeCompare(String(right.id)));
}

async function loadAdminBatches(s: SupabaseClient, jobIds: string[]) {
  const batches: Record<string, unknown>[] = [];
  for (let jobOffset = 0; jobOffset < jobIds.length; jobOffset += 50) {
    for (let rowOffset = 0; ; rowOffset += 1000) {
      const result = await s.from("fiscal_invoice_batches")
        .select("id,job_id,batch_sequence,preflight_run_id,period_from,period_to,local_date_from,local_date_to,status,payload_sha256,execution_decisions,requested_at,draft_completed_at,completed_at,error")
        .in("job_id", jobIds.slice(jobOffset, jobOffset + 50)).order("job_id").order("batch_sequence").range(rowOffset, rowOffset + 999);
      if (result.error) throw result.error;
      const page = records(result.data);
      batches.push(...page);
      if (page.length < 1000) break;
    }
  }
  return batches;
}

async function loadPreflightRows(s: SupabaseClient, runId: string) {
  const result: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const pageResult = await s.from("fiscal_preflight_items")
      .select("id,order_id,status,operation_at,operation_local_date,order_code,payment_reference,description,units,gross_cents,tax_base_cents,vat_cents,odoo_product_id,refund_required,source_sha256,source_snapshot,invoice_mode,invoice_request_id,customer_fiscal_details,customer_fiscal_details_sha256,supporting_sale_order_id,supporting_sale_order_source_sha256")
      .eq("run_id", runId).order("operation_at").order("order_id").range(offset, offset + 999);
    if (pageResult.error) throw pageResult.error;
    const page = records(pageResult.data);
    result.push(...page);
    if (page.length < 1000) return result;
  }
}

async function loadFiscalInvoiceSource(s: SupabaseClient, preflightRunId: string) {
  const { data: run, error: runError } = await s.from("fiscal_preflight_runs")
    .select("id,status,period_from,period_to,time_zone,currency,configuration_report_id,global_findings,summary,contract_version,local_month")
    .eq("id", preflightRunId).maybeSingle();
  if (runError) throw runError;
  if (!run) throw new Error("The selected fiscal preflight does not exist.");
  const globalBlockers = records(run.global_findings).filter((finding) => finding.severity === "blocker" && finding.code !== "odoo_configuration_stale");
  if (globalBlockers.length) throw new Error(`This run has a non-bypassable configuration blocker: ${globalBlockers.map((finding) => String(finding.message)).join(" ")}`);
  const [preflightRows, reportResult, settingsResult] = await Promise.all([
    loadPreflightRows(s, String(run.id)),
    s.from("odoo_fiscal_configuration_reports").select("id,checked_at,accepted,payload,payload_sha256")
      .eq("id", run.configuration_report_id).single(),
    s.from("odoo_fiscal_settings").select("journal_code,customer_odoo_id,currency,tax_treatment_approved").eq("singleton", true).single(),
  ]);
  for (const result of [reportResult, settingsResult]) if (result.error) throw result.error;
  const wholeMonthBlocker = Number(run.contract_version ?? 1) === 2 ? fiscalV2WholeMonthBlocker(preflightRows) : null;
  if (wholeMonthBlocker) throw new Error(wholeMonthBlocker);
  const supportingIds = [...new Set(preflightRows.map((row) => String(row.supporting_sale_order_id ?? "")).filter(Boolean))];
  const orderIds = Number(run.contract_version ?? 1) === 2 ? preflightRows.map((row) => String(row.order_id)) : [];
  const supportingRows: Record<string, unknown>[] = [];
  const currentOrderRows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < Math.max(supportingIds.length, orderIds.length); offset += 200) {
    const [supportingResult, currentOrdersResult] = await Promise.all([
      supportingIds.length > offset
        ? s.from("manufacturing_sale_order_documents").select("id,source_order_id,source_sha256,odoo_sale_order_id,odoo_sale_order_line_id").in("id", supportingIds.slice(offset, offset + 200))
        : Promise.resolve({ data: [], error: null }),
      orderIds.length > offset
        ? s.from("huaxin_orders").select("id,export_content_hash").in("id", orderIds.slice(offset, offset + 200))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (supportingResult.error) throw supportingResult.error;
    if (currentOrdersResult.error) throw currentOrdersResult.error;
    supportingRows.push(...((supportingResult.data as Record<string, unknown>[]) ?? []));
    currentOrderRows.push(...((currentOrdersResult.data as Record<string, unknown>[]) ?? []));
  }
  const supportingById = new Map(supportingRows.map((row) => [String(row.id), row]));
  const currentOrderHashById = new Map(currentOrderRows.map((row) => [String(row.id), row.export_content_hash]));
  const eligibleRows = preflightRows.filter((item) => item.status === "eligible");
  const allItems = eligibleRows.map((item): (FiscalInvoiceSourceItem | FiscalInvoiceSourceItemV2) & { operation_at: string } => {
    const base = {
    id: String(item.id), order_id: String(item.order_id), operation_at: String(item.operation_at),
    operation_local_date: String(item.operation_local_date), order_code: String(item.order_code),
    payment_reference: item.payment_reference == null ? null : String(item.payment_reference),
    description: String(item.description), units: Number(item.units), gross_cents: Number(item.gross_cents),
    tax_base_cents: Number(item.tax_base_cents), vat_cents: Number(item.vat_cents),
    odoo_product_id: Number(item.odoo_product_id), refund_required: Boolean(item.refund_required), source_sha256: String(item.source_sha256),
    zero_value_reason: zeroValueVendReason(String((item.source_snapshot as Record<string, unknown>)?.pay_type_raw ?? "") || null),
    };
    if (Number(run.contract_version ?? 1) !== 2) return base;
    const supporting = supportingById.get(String(item.supporting_sale_order_id));
    if (!supporting) throw new Error(`Frozen supporting sales-order mapping is missing for ${String(item.order_code)}.`);
    const supportingSourceHash = currentSupportingSaleOrderSourceHash(currentOrderHashById.get(String(item.order_id)), supporting.source_sha256);
    if (!supportingSourceHash || supportingSourceHash !== item.supporting_sale_order_source_sha256 || String(supporting.source_order_id) !== String(item.order_id)) {
      throw new Error(`Frozen supporting sales-order mapping is stale for ${String(item.order_code)}.`);
    }
    return { ...base,
      invoice_mode: String(item.invoice_mode) as FiscalInvoiceSourceItemV2["invoice_mode"],
      invoice_request_id: item.invoice_request_id == null ? null : String(item.invoice_request_id),
      customer_fiscal_details: item.customer_fiscal_details as FiscalInvoiceSourceItemV2["customer_fiscal_details"],
      customer_fiscal_details_sha256: item.customer_fiscal_details_sha256 == null ? null : String(item.customer_fiscal_details_sha256),
      supporting_sale_order_id: String(item.supporting_sale_order_id),
      supporting_sale_order_source_sha256: supportingSourceHash,
      odoo_sale_order_id: Number(supporting.odoo_sale_order_id), odoo_sale_order_line_id: Number(supporting.odoo_sale_order_line_id),
    };
  });
  const skippedRefundReview = allItems.filter((item) => item.refund_required).length;
  const items = allItems.filter((item) => !item.refund_required);
  if (!items.length) throw new Error("No invoiceable sales remain after blocked, excluded, and refund-review rows are skipped.");
  const report = reportResult.data as Record<string, unknown>;
  const settings = settingsResult.data as Record<string, unknown>;
  const payload = report.payload as Record<string, unknown>;
  if (sha256(payload) !== report.payload_sha256) throw new Error("The referenced configuration report payload hash is invalid.");
  if (settings.tax_treatment_approved !== true) throw new Error("The vending tax treatment is not currently approved.");
  return { run: run as Record<string, unknown>, items, report: {
    id: String(report.id), checked_at: String(report.checked_at), accepted: Boolean(report.accepted),
    payload_sha256: String(report.payload_sha256), payload,
  }, settings, skippedBlocked: preflightRows.filter((item) => item.status === "blocked").length,
  skippedExcluded: preflightRows.filter((item) => item.status === "excluded").length, skippedRefundReview };
}

export async function enqueueFiscalInvoiceDraftBatch(s: SupabaseClient, input: { preflightRunId: string; requestedBy: string }) {
  const source = await loadFiscalInvoiceSource(s, input.preflightRunId);
  if (Number(source.run.contract_version ?? 1) === 2) {
    const month = closedFiscalMonth(String(source.run.period_from), String(source.run.period_to), String(source.run.time_zone));
    if (!month || month.month !== source.run.local_month) throw new Error("Fiscal v2 requires one closed Europe/Madrid calendar month.");
    const items = source.items as FiscalInvoiceSourceItemV2[];
    const documentCount = items.filter((item) => item.invoice_mode === "individual_requested").length
      + (items.some((item) => item.invoice_mode === "monthly_consolidated") ? 1 : 0);
    const built = buildFiscalInvoiceDraftPayloadV2({
      report: source.report, currency: String(source.run.currency), journalCode: String(source.settings.journal_code),
      anonymousCustomerOdooId: Number(source.settings.customer_odoo_id), localMonth: month.month,
      monthInvoiceDate: month.invoiceDate, items, platformInvoiceIds: Array.from({ length: documentCount }, () => randomUUID()),
      platformAllocationIds: items.map(() => randomUUID()),
    });
    if (!built.payload || !built.payloadSha256) throw new Error(built.blockers[0] ?? "Fiscal invoice draft creation is blocked.");
    const documents = built.payload.invoices.map((invoice) => ({
      platform_invoice_id: invoice.platform_invoice_id, invoice_payload: invoice,
      invoice_payload_sha256: invoice.invoice_payload_sha256,
    }));
    const { data, error } = await s.rpc("create_fiscal_invoice_job_v2", {
      p_preflight_run_id: source.run.id, p_configuration_report_id: source.report.id,
      p_requested_by: input.requestedBy, p_payload: built.payload, p_payload_sha256: built.payloadSha256,
      p_documents: documents,
    });
    if (error) throwFiscalQueueError(error);
    return data as { job_id: string; request_id: string; document_count: number; allocation_count: number; batch_count: number; skipped_blocked: number; skipped_excluded: number; skipped_refund_review: number };
  }
  const platformInvoiceIds = source.items.map(() => randomUUID());
  const built = buildFiscalInvoiceDraftBatches({
    now: Date.now(), report: source.report, currency: String(source.run.currency),
    journalCode: String(source.settings.journal_code), customerOdooId: Number(source.settings.customer_odoo_id),
    items: source.items, platformInvoiceIds,
  });
  if (!built.batches.length) throw new Error(built.blockers[0] ?? "Fiscal invoice draft creation is blocked.");
  const batches = built.batches.map((batch) => ({
    sequence: batch.sequence,
    payload: batch.payload,
    payload_sha256: batch.payloadSha256,
    documents: batch.payload.invoices.map((invoice, index) => {
      const item = source.items[(batch.sequence - 1) * 500 + index];
      return {
        platform_invoice_id: invoice.platform_invoice_id, preflight_item_id: item.id,
        invoice_payload: invoice, invoice_payload_sha256: invoice.invoice_payload_sha256,
        odoo_tax_id: batch.payload.tax.odoo_tax_id, reference: invoice.reference,
      };
    }),
  }));
  const { data, error } = await s.rpc("create_fiscal_invoice_job", {
    p_preflight_run_id: source.run.id, p_configuration_report_id: source.report.id, p_requested_by: input.requestedBy,
    p_batches: batches,
  });
  if (error) throwFiscalQueueError(error);
  return data as { job_id: string; request_id: string; document_count: number; batch_count: number; skipped_blocked: number; skipped_excluded: number; skipped_refund_review: number };
}

export async function getFiscalInvoiceQueuePreview(preflightRunId: string): Promise<FiscalInvoiceQueuePreview> {
  const fallback: FiscalInvoiceQueuePreview = {
    runId: preflightRunId, queueable: false, blockers: [], warnings: [], invoiceCount: 0,
    skippedBlocked: 0, skippedExcluded: 0, skippedRefundReview: 0,
    internalBatchCount: 0, internalBatchSizes: [],
  };
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ...fallback, blockers: ["Supabase is not configured."] };
  try {
    const s = await createServiceClient();
    const source = await loadFiscalInvoiceSource(s, preflightRunId);
    if (Number(source.run.contract_version ?? 1) === 2) {
      const month = closedFiscalMonth(String(source.run.period_from), String(source.run.period_to), String(source.run.time_zone));
      const items = source.items as FiscalInvoiceSourceItemV2[];
      if (!month || month.month !== source.run.local_month) return { ...fallback, blockers: ["Fiscal v2 requires one closed Europe/Madrid calendar month."] };
      const documentCount = items.filter((item) => item.invoice_mode === "individual_requested").length
        + (items.some((item) => item.invoice_mode === "monthly_consolidated") ? 1 : 0);
      const built = buildFiscalInvoiceDraftPayloadV2({
        report: source.report, currency: String(source.run.currency), journalCode: String(source.settings.journal_code),
        anonymousCustomerOdooId: Number(source.settings.customer_odoo_id), localMonth: month.month,
        monthInvoiceDate: month.invoiceDate, items, platformInvoiceIds: Array.from({ length: documentCount }, () => randomUUID()),
        platformAllocationIds: items.map(() => randomUUID()),
      });
      const [overlapResult, activeRequestResult] = await Promise.all([
        s.from("fiscal_invoice_jobs").select("id,status,local_date_from,local_date_to")
          .lt("period_from", String(source.run.period_to)).gt("period_to", String(source.run.period_from))
          .neq("status", "cancelled").limit(1).maybeSingle(),
        s.from("odoo_sync_requests").select("id,status").eq("kind", "fiscal_invoice_draft_creation")
          .in("status", ["pending", "processing"]).limit(1).maybeSingle(),
      ]);
      if (overlapResult.error) throw overlapResult.error;
      if (activeRequestResult.error) throw activeRequestResult.error;
      const blockers = [...built.blockers];
      if (overlapResult.data) blockers.push(`An existing ${overlapResult.data.status} invoice batch already covers this month.`);
      if (activeRequestResult.data) blockers.push("Another Odoo invoice-draft request is already pending or processing.");
      const warnings = Date.now() - Date.parse(source.report.checked_at) > 24 * 60 * 60_000
        ? ["The immutable Odoo configuration report is more than 24 hours old. Its accepted identities and hash will still be enforced."] : [];
      return { ...fallback, queueable: blockers.length === 0, blockers, warnings,
        invoiceCount: documentCount, skippedBlocked: source.skippedBlocked, skippedExcluded: source.skippedExcluded,
        skippedRefundReview: source.skippedRefundReview, internalBatchCount: built.payload ? 1 : 0,
        internalBatchSizes: built.payload ? [built.payload.invoices.length] : [] };
    }
    const platformInvoiceIds = source.items.map(() => randomUUID());
    const built = buildFiscalInvoiceDraftBatches({
      now: Date.now(), report: source.report, currency: String(source.run.currency),
      journalCode: String(source.settings.journal_code), customerOdooId: Number(source.settings.customer_odoo_id),
      items: source.items, platformInvoiceIds,
    });
    const [overlapResult, activeRequestResult] = await Promise.all([
      s.from("fiscal_invoice_jobs").select("id,status,local_date_from,local_date_to")
        .lt("period_from", String(source.run.period_to)).gt("period_to", String(source.run.period_from))
        .neq("status", "cancelled").limit(1).maybeSingle(),
      s.from("odoo_sync_requests").select("id,status").eq("kind", "fiscal_invoice_draft_creation")
        .in("status", ["pending", "processing"]).limit(1).maybeSingle(),
    ]);
    if (overlapResult.error) throw overlapResult.error;
    if (activeRequestResult.error) throw activeRequestResult.error;
    const blockers = [...built.blockers];
    if (overlapResult.data) blockers.push(`An existing ${overlapResult.data.status} invoice batch already covers ${overlapResult.data.local_date_from} through ${overlapResult.data.local_date_to}.`);
    if (activeRequestResult.data) blockers.push("Another Odoo invoice-draft request is already pending or processing.");
    const reportAge = Date.now() - Date.parse(source.report.checked_at);
    const warnings = reportAge > 24 * 60 * 60_000
      ? ["The immutable Odoo configuration report is more than 24 hours old. Its accepted identities and hash will still be enforced."]
      : [];
    return {
      runId: preflightRunId, queueable: blockers.length === 0, blockers, warnings,
      invoiceCount: source.items.length, skippedBlocked: source.skippedBlocked,
      skippedExcluded: source.skippedExcluded, skippedRefundReview: source.skippedRefundReview,
      internalBatchCount: built.batches.length,
      internalBatchSizes: built.batches.map((batch) => batch.payload.invoices.length),
    };
  } catch (error) {
    return { ...fallback, blockers: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function getFiscalInvoiceAdminData(month: string): Promise<FiscalInvoiceAdminData> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return EMPTY;
  try {
    if (!isFiscalCalendarMonth(month)) throw new Error("Invalid fiscal calendar month.");
    const { first, last } = fiscalCalendarMonth(month, []);
    const s = await createServiceClient();
    const jobColumns = "id,preflight_run_id,period_from,period_to,local_date_from,local_date_to,status,execution_decisions,requested_at,draft_completed_at,completed_at,error";
    const [calendarResult, actionableResult] = await Promise.all([
      s.from("fiscal_invoice_jobs").select(jobColumns).lte("local_date_from", last).gte("local_date_to", first)
        .order("local_date_from").limit(100),
      s.from("fiscal_invoice_jobs").select(jobColumns)
        .in("status", ["draft_pending", "draft_ready", "confirmation_pending", "confirmation_failed", "failed"])
        .order("requested_at", { ascending: false }).limit(50),
    ]);
    if (calendarResult.error) throw calendarResult.error;
    if (actionableResult.error) throw actionableResult.error;
    const jobRows = new Map<string, Record<string, unknown>>();
    for (const job of [...records(calendarResult.data), ...records(actionableResult.data)]) jobRows.set(String(job.id), job);
    const rawJobs = [...jobRows.values()];
    const jobIds = rawJobs.map((job) => String(job.id));
    const [rawBatches, progressResult] = await Promise.all([
      jobIds.length ? loadAdminBatches(s, jobIds) : Promise.resolve([]),
      jobIds.length ? s.from("fiscal_invoice_job_progress").select("*").in("job_id", jobIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (progressResult.error) throw progressResult.error;
    const progressByJob = new Map(records(progressResult.data).map((progress) => [String(progress.job_id), progress]));
    const batches = rawBatches.map((batch): FiscalInvoiceBatchAdmin => ({
      id: String(batch.id), job_id: String(batch.job_id), batch_sequence: Number(batch.batch_sequence), preflight_run_id: String(batch.preflight_run_id),
      period_from: String(batch.period_from), period_to: String(batch.period_to), local_date_from: String(batch.local_date_from), local_date_to: String(batch.local_date_to), status: String(batch.status),
      payload_sha256: String(batch.payload_sha256), requested_at: String(batch.requested_at), execution_decisions: (batch.execution_decisions && typeof batch.execution_decisions === "object" ? batch.execution_decisions : {}) as FiscalInvoiceBatchAdmin["execution_decisions"],
      draft_completed_at: batch.draft_completed_at == null ? null : String(batch.draft_completed_at), completed_at: batch.completed_at == null ? null : String(batch.completed_at), error: batch.error == null ? null : String(batch.error),
    }));
    const documentRows = batches.length ? await loadAdminDocuments(s, batches.map((batch) => batch.id)) : [];
    const documents = documentRows.map((document): FiscalInvoiceDocumentAdmin => ({
      id: String(document.id), batch_id: String(document.batch_id), invoice_date: String(document.invoice_date),
      order_code: document.order_code == null
        ? document.invoice_mode === "monthly_consolidated" ? "Monthly consolidated" : "Customer requested"
        : String(document.order_code), reference: String(document.reference), currency: String(document.currency),
      gross_cents: Number(document.gross_cents), tax_base_cents: Number(document.tax_base_cents), vat_cents: Number(document.vat_cents),
      status: String(document.status), odoo_move_id: document.odoo_move_id == null ? null : Number(document.odoo_move_id),
      odoo_state: document.odoo_state == null ? null : String(document.odoo_state), odoo_name: document.odoo_name == null ? null : String(document.odoo_name),
      invoice_payload_sha256: String(document.invoice_payload_sha256),
      contract_version: Number(document.contract_version ?? 1), invoice_mode: document.invoice_mode == null ? null : String(document.invoice_mode),
    }));
    const jobs = rawJobs.map((job): FiscalInvoiceJobAdmin => {
      const childIds = new Set(batches.filter((batch) => batch.job_id === String(job.id)).map((batch) => batch.id));
      const childBatches = batches.filter((batch) => childIds.has(batch.id));
      const progress = progressByJob.get(String(job.id));
      return {
        id: String(job.id), preflight_run_id: String(job.preflight_run_id), local_date_from: String(job.local_date_from), local_date_to: String(job.local_date_to), status: String(job.status),
        requested_at: String(job.requested_at), completed_at: job.completed_at == null ? null : String(job.completed_at), error: job.error == null ? null : String(job.error),
        execution_decisions: (job.execution_decisions && typeof job.execution_decisions === "object" ? job.execution_decisions : {}) as FiscalInvoiceBatchAdmin["execution_decisions"],
        document_count: Number(progress?.document_count ?? 0), draft_count: Number(progress?.draft_count ?? 0),
        posted_count: Number(progress?.posted_count ?? 0), gross_cents: Number(progress?.gross_cents ?? 0), internal_batch_count: Number(progress?.internal_batch_count ?? childBatches.length),
        completed_internal_batch_count: Number(progress?.completed_internal_batch_count ?? 0),
      };
    }).sort((left, right) => right.requested_at.localeCompare(left.requested_at));
    return { available: true, jobs, batches, documents };
  } catch {
    return EMPTY;
  }
}
