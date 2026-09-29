import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFiscalInvoiceConfirmationPayload } from "../odoo-fiscal-invoices.ts";
import { sha256 } from "../odoo-sync-contract.ts";

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

function throwFiscalQueueError(error: { code?: string; message?: string }): never {
  if (error.code === "23P01") throw new Error("This period overlaps an existing non-cancelled fiscal invoice batch.");
  if (error.code === "23505") throw new Error("The fiscal invoice request conflicts with an existing source order, Odoo move, or active queue request.");
  throw error;
}

export async function enqueueFiscalInvoiceConfirmation(s: SupabaseClient, input: { batchId: string; documentIds: string[]; requestedBy: string }) {
  if (!input.documentIds.length || new Set(input.documentIds).size !== input.documentIds.length) throw new Error("Select one or more unique draft invoices.");
  const [batchResult, documentsResult] = await Promise.all([
    s.from("fiscal_invoice_batches").select("id,status,payload").eq("id", input.batchId).single(),
    s.from("fiscal_invoice_documents").select("id,batch_id,status,odoo_move_id,invoice_payload_sha256")
      .in("id", input.documentIds).order("id"),
  ]);
  if (batchResult.error) throw batchResult.error;
  if (documentsResult.error) throw documentsResult.error;
  const documents = records(documentsResult.data);
  if (documents.length !== input.documentIds.length || documents.some((document) => document.batch_id !== input.batchId || document.status !== "draft")) {
    throw new Error("Only exact draft invoices from the selected batch can be confirmed.");
  }
  const batchPayload = batchResult.data.payload as Record<string, unknown>;
  const company = batchPayload.company as Record<string, unknown>;
  const payload = buildFiscalInvoiceConfirmationPayload(Number(company.odoo_id), documents.map((document) => ({
    platform_invoice_id: String(document.id), odoo_move_id: Number(document.odoo_move_id),
    invoice_payload_sha256: String(document.invoice_payload_sha256),
  })));
  const payloadSha256 = sha256(payload);
  const { data, error } = await s.rpc("queue_fiscal_invoice_confirmation", {
    p_batch_id: input.batchId, p_requested_by: input.requestedBy, p_document_ids: input.documentIds,
    p_payload: payload, p_payload_sha256: payloadSha256,
  });
  if (error) throwFiscalQueueError(error);
  return data as { batch_id: string; request_id: string; document_count: number };
}

export async function retryFiscalInvoiceDraftBatch(s: SupabaseClient, input: { batchId: string; requestedBy: string }) {
  const { data, error } = await s.rpc("retry_fiscal_invoice_draft_batch", {
    p_batch_id: input.batchId,
    p_requested_by: input.requestedBy,
  });
  if (error) throwFiscalQueueError(error);
  return data as { batch_id: string; request_id: string; document_count: number };
}
