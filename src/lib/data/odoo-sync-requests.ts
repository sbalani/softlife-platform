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
