import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimOdooSyncRequest, completeOdooSyncRequest, enqueueOdooFiscalRemediationRequest } from "./odoo-sync-requests.ts";

test("claim returns the durable request from the database RPC", async () => {
  const client = { rpc: async () => ({ data: { id: "request-id", status: "processing" }, error: null }) } as unknown as SupabaseClient;
  assert.deepEqual(await claimOdooSyncRequest(client), { request: { id: "request-id", status: "processing" } });
});

test("result validation rejects success without a summary", async () => {
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { kind: "stock_snapshot", payload: {} }, error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    completeOdooSyncRequest(client, "d58e68dd-21a6-4a55-8cf4-d7a26bba1264", { accepted: true, claim_token: "7cbd854e-3f88-4ca3-b86b-a4853adffbd3" }),
    /require a summary/,
  );
});

test("invoice completion validates identity then calls the generic completion RPC", async () => {
  const rpcCalls: unknown[] = [];
  const payload = { invoices: [{ platform_invoice_id: "44444444-4444-4444-8444-444444444444", invoice_payload_sha256: "a".repeat(64) }] };
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { kind: "fiscal_invoice_draft_creation", payload }, error: null }) }) }) }),
    rpc: async (name: string, args: unknown) => { rpcCalls.push([name, args]); return { data: { status: "completed" }, error: null }; },
  } as unknown as SupabaseClient;
  const body = {
    accepted: true, claim_token: "7cbd854e-3f88-4ca3-b86b-a4853adffbd3",
    invoices: [{ platform_invoice_id: payload.invoices[0].platform_invoice_id, invoice_payload_sha256: "a".repeat(64), odoo_move_id: 9, state: "draft", created: true }],
  };
  assert.deepEqual(await completeOdooSyncRequest(client, "d58e68dd-21a6-4a55-8cf4-d7a26bba1264", body), { request: { status: "completed" } });
  assert.equal(rpcCalls.length, 1);
});

test("remediation queue adapter writes only the constrained kind and frozen payload", async () => {
  const inserted: Record<string, unknown>[] = [];
  const client = { from(table: string) {
    assert.equal(table, "odoo_sync_requests");
    return { insert(value: Record<string, unknown>) {
      inserted.push(value);
      return { select: () => ({ single: async () => ({ data: { id: "queued-id" }, error: null }) }) };
    } };
  } } as unknown as SupabaseClient;
  const payload = { contract_version: 1, products: [{ odoo_product_id: 101 }] };
  const queued = await enqueueOdooFiscalRemediationRequest(client, {
    requestedBy: "actor-id", payload, payloadSha256: "a".repeat(64),
  });
  assert.equal(queued.requestId, "queued-id");
  assert.deepEqual(inserted, [{ kind: "fiscal_product_remediation", requested_by: "actor-id", payload, payload_sha256: "a".repeat(64) }]);
});
