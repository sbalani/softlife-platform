import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueFiscalInvoiceConfirmation, retryFiscalInvoiceDraftBatch } from "./odoo-fiscal-invoice-requests.ts";
import { sha256 } from "../odoo-sync-contract.ts";

test("confirmation adapter sends the exact selected IDs and trusted document payload", async () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const documents = ids.map((id, index) => ({
    id, batch_id: "33333333-3333-4333-8333-333333333333", status: "draft",
    odoo_move_id: 90 + index, invoice_payload_sha256: String(index + 1).repeat(64),
  }));
  const client = {
    from(table: string) {
      if (table === "fiscal_invoice_batches") return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "batch", status: "draft_ready", payload: { company: { odoo_id: 3 } } }, error: null }) }) }) };
      return { select: () => ({ in: (_column: string, selected: string[]) => {
        assert.deepEqual(selected, ids);
        return { order: async () => ({ data: documents, error: null }) };
      } }) };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { batch_id: args.p_batch_id, request_id: "request", document_count: 2 }, error: null };
    },
  } as unknown as SupabaseClient;
  await enqueueFiscalInvoiceConfirmation(client, { batchId: "33333333-3333-4333-8333-333333333333", documentIds: ids, requestedBy: "actor" });
  assert.equal(calls[0].name, "queue_fiscal_invoice_confirmation");
  assert.deepEqual(calls[0].args.p_document_ids, ids);
  const payload = calls[0].args.p_payload as Record<string, unknown>;
  assert.equal(calls[0].args.p_payload_sha256, sha256(payload));
  assert.deepEqual((payload.invoices as Record<string, unknown>[]).map((invoice) => invoice.platform_invoice_id), ids);
});

test("draft retry adapter delegates only batch and actor to the retry RPC", async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args: unknown) => {
    calls.push([name, args]);
    return { data: { batch_id: "batch", request_id: "request", document_count: 3 }, error: null };
  } } as unknown as SupabaseClient;
  const result = await retryFiscalInvoiceDraftBatch(client, { batchId: "batch", requestedBy: "actor" });
  assert.deepEqual(result, { batch_id: "batch", request_id: "request", document_count: 3 });
  assert.deepEqual(calls, [["retry_fiscal_invoice_draft_batch", { p_batch_id: "batch", p_requested_by: "actor" }]]);
});
