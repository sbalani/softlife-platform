import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelEmptyFailedFiscalInvoiceJob, enqueueFiscalInvoiceConfirmation, retryFiscalInvoiceDraftBatch } from "./odoo-fiscal-invoice-requests.ts";

test("confirmation adapter builds trusted payloads for every unfinished internal batch", async () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const documents = ids.map((id, index) => ({
    id, status: "draft",
    odoo_move_id: 90 + index, invoice_payload_sha256: String(index + 1).repeat(64),
  }));
  const client = {
    from(table: string) {
      if (table === "fiscal_invoice_batches") return { select: () => ({ eq: () => ({ neq: () => ({ order: async () => ({ data: [{ id: "batch", batch_sequence: 1, status: "draft_ready", contract_version: 2, payload: { company: { odoo_id: 3 } } }], error: null }) }) }) }) };
      return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: documents, error: null }) }) }) }) };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { job_id: args.p_job_id, request_id: "request", document_count: 2, batch_count: 1 }, error: null };
    },
  } as unknown as SupabaseClient;
  await enqueueFiscalInvoiceConfirmation(client, { jobId: "33333333-3333-4333-8333-333333333333", requestedBy: "actor" });
  assert.equal(calls[0].name, "queue_fiscal_invoice_job_confirmation");
  const batches = calls[0].args.p_batches as { payload: { contract_version: number; invoices: Record<string, unknown>[] } }[];
  assert.equal(batches[0].payload.contract_version, 2);
  assert.deepEqual(batches[0].payload.invoices.map((invoice) => invoice.platform_invoice_id), ids);
});

test("draft retry adapter delegates only job and actor to the retry RPC", async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args: unknown) => {
    calls.push([name, args]);
    return { data: { job_id: "job", batch_id: "batch", request_id: "request", document_count: 3 }, error: null };
  } } as unknown as SupabaseClient;
  const result = await retryFiscalInvoiceDraftBatch(client, { jobId: "job", requestedBy: "actor" });
  assert.deepEqual(result, { job_id: "job", batch_id: "batch", request_id: "request", document_count: 3 });
  assert.deepEqual(calls, [["retry_fiscal_invoice_draft_job", { p_job_id: "job", p_requested_by: "actor" }]]);
});

test("failed empty job cancellation records the actor", async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args: unknown) => {
    calls.push([name, args]);
    return { data: { job_id: "job", document_count: 793 }, error: null };
  } } as unknown as SupabaseClient;
  const result = await cancelEmptyFailedFiscalInvoiceJob(client, { jobId: "job", cancelledBy: "actor" });
  assert.deepEqual(result, { job_id: "job", document_count: 793 });
  assert.deepEqual(calls, [["cancel_empty_failed_fiscal_invoice_job", { p_job_id: "job", p_cancelled_by: "actor" }]]);
});
