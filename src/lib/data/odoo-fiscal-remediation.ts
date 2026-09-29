import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "../supabase/server";
import {
  buildFiscalRemediationPreview,
  type FiscalRemediationPreview,
  type FiscalRemediationRequest,
  type FiscalRemediationRecipe,
} from "../odoo-fiscal-remediation.ts";
import type { FiscalSettings } from "../odoo-fiscal-preflight.ts";
import { enqueueOdooFiscalRemediationRequest } from "./odoo-sync-requests.ts";

const UNAVAILABLE: FiscalRemediationPreview = {
  available: false,
  report: null,
  blockers: ["Apply the fiscal product remediation migration before using this control."],
  missingProducts: [],
  products: [],
  target: null,
  payload: null,
  payloadSha256: null,
  latestRequest: null,
};

function settingsFromRow(row: Record<string, unknown>): FiscalSettings {
  return {
    journal_code: String(row.journal_code),
    customer_odoo_id: Number(row.customer_odoo_id),
    vat_rate: Number(row.vat_rate),
    currency: String(row.currency),
    income_account_code: String(row.income_account_code),
    tax_treatment_approved: Boolean(row.tax_treatment_approved),
    posting_enabled: Boolean(row.posting_enabled),
  };
}

function requestFromRow(row: Record<string, unknown> | null): FiscalRemediationRequest | null {
  return row ? {
    id: String(row.id),
    status: String(row.status),
    requested_at: String(row.requested_at),
    claimed_at: row.claimed_at == null ? null : String(row.claimed_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at),
    attempts: Number(row.attempts),
    result: row.result && typeof row.result === "object" && !Array.isArray(row.result) ? row.result as Record<string, unknown> : null,
    error: row.error == null ? null : String(row.error),
  } : null;
}

async function loadRemediationSource(s: SupabaseClient) {
  const [settingsResult, reportResult, recipesResult, requestResult, activeRequestResult] = await Promise.all([
    s.from("odoo_fiscal_settings").select("*").eq("singleton", true).single(),
    s.from("odoo_fiscal_configuration_reports").select("id,checked_at,accepted,payload,payload_sha256,created_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    s.from("recipes").select("name,odoo_finished_product_id").eq("active", true).not("odoo_finished_product_id", "is", null).order("odoo_finished_product_id"),
    s.from("odoo_sync_requests").select("id,status,requested_at,claimed_at,completed_at,attempts,result,error")
      .eq("kind", "fiscal_product_remediation").order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    s.from("odoo_sync_requests").select("id").eq("kind", "fiscal_product_remediation")
      .in("status", ["pending", "processing"]).limit(1).maybeSingle(),
  ]);
  for (const result of [settingsResult, reportResult, recipesResult, requestResult, activeRequestResult]) if (result.error) throw result.error;
  const reportRow = reportResult.data as Record<string, unknown> | null;
  return {
    settings: settingsFromRow(settingsResult.data as Record<string, unknown>),
    report: reportRow ? {
      id: String(reportRow.id), checked_at: String(reportRow.checked_at), accepted: Boolean(reportRow.accepted),
      payload_sha256: String(reportRow.payload_sha256), payload: reportRow.payload as Record<string, unknown>,
    } : null,
    recipes: ((recipesResult.data as Record<string, unknown>[]) ?? []).map((row): FiscalRemediationRecipe => ({
      name: String(row.name), odoo_finished_product_id: row.odoo_finished_product_id == null ? null : Number(row.odoo_finished_product_id),
    })),
    latestRequest: requestFromRow(requestResult.data as Record<string, unknown> | null),
    hasActiveRequest: Boolean(activeRequestResult.data),
  };
}

export async function getFiscalRemediationAdminData(): Promise<FiscalRemediationPreview> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return UNAVAILABLE;
  try {
    const source = await loadRemediationSource(await createServiceClient());
    return buildFiscalRemediationPreview(source);
  } catch {
    return UNAVAILABLE;
  }
}

export async function enqueueFiscalProductRemediation(s: SupabaseClient, input: {
  configurationReportId: string;
  configurationPayloadSha256: string;
  requestedBy: string;
}) {
  const source = await loadRemediationSource(s);
  if (!source.report
    || source.report.id !== input.configurationReportId
    || source.report.payload_sha256 !== input.configurationPayloadSha256) {
    throw new Error("The Odoo fiscal configuration report changed. Review the latest preview before queueing remediation.");
  }
  const preview = buildFiscalRemediationPreview(source);
  if (!preview.payload || !preview.payloadSha256) throw new Error(preview.blockers[0] ?? "Fiscal product remediation is not ready.");
  const queued = await enqueueOdooFiscalRemediationRequest(s, {
    requestedBy: input.requestedBy,
    payload: preview.payload,
    payloadSha256: preview.payloadSha256,
  });
  return { ...queued, productCount: preview.payload.products.length, payloadSha256: preview.payloadSha256 };
}
