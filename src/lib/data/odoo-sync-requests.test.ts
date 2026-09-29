import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimOdooSyncRequest, completeOdooSyncRequest, enqueueOdooFiscalRemediationRequest } from "./odoo-sync-requests.ts";

test("claim returns the durable request from the database RPC", async () => {
  const client = { rpc: async () => ({ data: { id: "request-id", status: "processing" }, error: null }) } as unknown as SupabaseClient;
  assert.deepEqual(await claimOdooSyncRequest(client), { request: { id: "request-id", status: "processing" } });
});

test("result validation rejects success without a summary", async () => {
  const client = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
  await assert.rejects(
    completeOdooSyncRequest(client, "d58e68dd-21a6-4a55-8cf4-d7a26bba1264", { accepted: true, claim_token: "7cbd854e-3f88-4ca3-b86b-a4853adffbd3" }),
    /require a summary/,
  );
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
