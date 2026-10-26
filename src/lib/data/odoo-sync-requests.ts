import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson } from "../odoo-sync-contract.ts";
import { FISCAL_INVOICE_MAX_RESULT_BYTES, validateFiscalInvoiceResult } from "../odoo-fiscal-invoices.ts";
import { OdooContractError } from "./odoo-production.ts";
import { validateFiscalSaleLinkResult, type FiscalSaleLinkPayload } from "../odoo-fiscal-sale-links.ts";
import { PAYOUT_SELF_BILL_MAX_RESULT_BYTES, validatePayoutSelfBillResult, type PayoutSelfBillKind } from "../payout-self-billing.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function claimOdooSyncRequest(s: SupabaseClient) {
  const { data, error } = await s.rpc("claim_odoo_sync_request");
  if (error) throw error;
  return { request: data ?? null };
}

export async function completeOdooSyncRequest(s: SupabaseClient, requestId: string, body: Record<string, unknown>) {
  if (!UUID.test(requestId)) throw new OdooContractError("Valid sync request ID is required");
  const claimToken = String(body.claim_token ?? "");
  if (!UUID.test(claimToken)) throw new OdooContractError("Valid sync request lease is required");
  if (typeof body.accepted !== "boolean") throw new OdooContractError("accepted must be boolean");
  if (!body.accepted && (typeof body.error !== "string" || !body.error.trim())) {
    throw new OdooContractError("Failed sync results require an error");
  }
  const { data: source, error: sourceError } = await s.from("odoo_sync_requests").select("kind,payload").eq("id", requestId).single();
  if (sourceError) throw sourceError;
  const fiscalInvoiceKind = ["fiscal_invoice_draft_creation", "fiscal_invoice_bulk_confirmation"].includes(source.kind);
  const fiscalSaleLinkKind = source.kind === "fiscal_invoice_sale_link";
  const payoutSelfBillKind = ["payout_vendor_bill_draft_creation", "payout_vendor_bill_posting", "payout_vendor_bill_pdf_export"].includes(source.kind);
  if (Buffer.byteLength(canonicalJson(body), "utf8") > (fiscalInvoiceKind ? FISCAL_INVOICE_MAX_RESULT_BYTES : fiscalSaleLinkKind ? 250_000 : payoutSelfBillKind ? PAYOUT_SELF_BILL_MAX_RESULT_BYTES : 20_000)) throw new OdooContractError("Sync result is too large", 413, "payload_too_large");
  if (body.accepted && !fiscalInvoiceKind && !fiscalSaleLinkKind && !payoutSelfBillKind && (typeof body.summary !== "string" || !body.summary.trim())) {
    throw new OdooContractError("Successful sync results require a summary");
  }
  if (fiscalInvoiceKind) {
    try {
      validateFiscalInvoiceResult(source.kind, source.payload as Record<string, unknown>, body);
    } catch (error) {
      throw new OdooContractError(error instanceof Error ? error.message : "Invalid fiscal invoice result");
    }
  }
  if (fiscalSaleLinkKind) {
    try {
      validateFiscalSaleLinkResult(source.payload as FiscalSaleLinkPayload, body);
    } catch (error) {
      throw new OdooContractError(error instanceof Error ? error.message : "Invalid fiscal sale-link result");
    }
  }
  if (payoutSelfBillKind) {
    try {
      validatePayoutSelfBillResult(source.kind as PayoutSelfBillKind, source.payload, body);
    } catch (error) {
      throw new OdooContractError(error instanceof Error ? error.message : "Invalid payout self-bill result");
    }
  }
  const rpcName = fiscalSaleLinkKind ? "complete_fiscal_invoice_sale_link_request" : "complete_odoo_sync_request";
  const { data, error } = await s.rpc(rpcName, { p_request_id: requestId, p_claim_token: claimToken, p_result: body });
  if (error) {
    if (error.code === "P0001") throw new OdooContractError(error.message, 409, "invalid_status");
    throw error;
  }
  return { request: data };
}

export async function enqueueOdooFiscalRemediationRequest(s: SupabaseClient, input: {
  requestedBy: string;
  payload: Record<string, unknown>;
  payloadSha256: string;
}) {
  if (!/^[0-9a-f]{64}$/.test(input.payloadSha256) || canonicalJson(input.payload) === "{}") {
    throw new OdooContractError("A nonempty frozen remediation payload and SHA-256 are required");
  }
  const { data, error } = await s.from("odoo_sync_requests").insert({
    kind: "fiscal_product_remediation",
    requested_by: input.requestedBy,
    payload: input.payload,
    payload_sha256: input.payloadSha256,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") throw new OdooContractError("A fiscal product remediation request is already active", 409, "active_request");
    throw error;
  }
  return { requestId: String(data.id) };
}
