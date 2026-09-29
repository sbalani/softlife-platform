import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson } from "../odoo-sync-contract.ts";
import { OdooContractError } from "./odoo-production.ts";

export async function claimOdooSyncRequest(s: SupabaseClient) {
  const { data, error } = await s.rpc("claim_odoo_sync_request");
  if (error) throw error;
  return { request: data ?? null };
}

export async function completeOdooSyncRequest(s: SupabaseClient, requestId: string, body: Record<string, unknown>) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new OdooContractError("Valid sync request ID is required");
  const claimToken = String(body.claim_token ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(claimToken)) throw new OdooContractError("Valid sync request lease is required");
  if (typeof body.accepted !== "boolean") throw new OdooContractError("accepted must be boolean");
  if (canonicalJson(body).length > 20_000) throw new OdooContractError("Sync result is too large", 413, "payload_too_large");
  if (body.accepted && (typeof body.summary !== "string" || !body.summary.trim())) {
    throw new OdooContractError("Successful sync results require a summary");
  }
  if (!body.accepted && (typeof body.error !== "string" || !body.error.trim())) {
    throw new OdooContractError("Failed sync results require an error");
  }
  const { data, error } = await s.rpc("complete_odoo_sync_request", { p_request_id: requestId, p_claim_token: claimToken, p_result: body });
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
