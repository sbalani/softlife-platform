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

export async function enqueueFiscalInvoiceConfirmation(s: SupabaseClient, input: { jobId: string; requestedBy: string }) {
  const { data: batchesData, error: batchesError } = await s.from("fiscal_invoice_batches")
    .select("id,batch_sequence,status,payload").eq("job_id", input.jobId).neq("status", "completed").order("batch_sequence");
  if (batchesError) throw batchesError;
  const batches = records(batchesData);
  if (!batches.length || batches.some((batch) => !["draft_ready", "confirmation_failed"].includes(String(batch.status)))) {
    throw new Error("Every unfinished internal batch must be ready for confirmation.");
  }
  const confirmationBatches = [];
  for (const batch of batches) {
    const { data, error } = await s.from("fiscal_invoice_documents").select("id,status,odoo_move_id,invoice_payload_sha256")
      .eq("batch_id", String(batch.id)).eq("status", "draft").order("id");
    if (error) throw error;
    const documents = records(data);
    if (!documents.length || documents.length > 500) throw new Error("Each internal batch must contain between 1 and 500 draft invoices.");
    const company = (batch.payload as Record<string, unknown>).company as Record<string, unknown>;
    const payload = buildFiscalInvoiceConfirmationPayload(Number(company.odoo_id), documents.map((document) => ({
      platform_invoice_id: String(document.id), odoo_move_id: Number(document.odoo_move_id), invoice_payload_sha256: String(document.invoice_payload_sha256),
    })));
    confirmationBatches.push({ batch_id: batch.id, payload, payload_sha256: sha256(payload) });
  }
  const { data, error } = await s.rpc("queue_fiscal_invoice_job_confirmation", {
    p_job_id: input.jobId, p_requested_by: input.requestedBy, p_batches: confirmationBatches,
  });
  if (error) throwFiscalQueueError(error);
  return data as { job_id: string; request_id: string; document_count: number; batch_count: number };
}

export async function retryFiscalInvoiceDraftBatch(s: SupabaseClient, input: { jobId: string; requestedBy: string }) {
  const { data, error } = await s.rpc("retry_fiscal_invoice_draft_job", {
    p_job_id: input.jobId,
    p_requested_by: input.requestedBy,
  });
  if (error) throwFiscalQueueError(error);
  return data as { batch_id: string; request_id: string; document_count: number };
}

export async function cancelEmptyFailedFiscalInvoiceJob(s: SupabaseClient, input: { jobId: string; cancelledBy: string }) {
  const { data, error } = await s.rpc("cancel_empty_failed_fiscal_invoice_job", {
    p_job_id: input.jobId,
    p_cancelled_by: input.cancelledBy,
  });
  if (error) throwFiscalQueueError(error);
  return data as { job_id: string; document_count: number };
}
