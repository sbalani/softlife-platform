import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimOdooSyncRequest, completeOdooSyncRequest } from "./odoo-sync-requests.ts";

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
