import { createHash } from "node:crypto";
import { isOdooSyncAuthorized } from "@/lib/auth/odoo-sync";
import { createServiceClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const BUCKET = "payout-self-bills";

function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PDF_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOdooSyncAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const requestId = request.headers.get("x-odoo-request-id") ?? "";
  const claimToken = request.headers.get("x-odoo-claim-token") ?? "";
  const moveId = positiveInteger(request.headers.get("x-odoo-move-id"));
  const attachmentId = positiveInteger(request.headers.get("x-odoo-attachment-id"));
  const claimedHash = request.headers.get("x-pdf-sha256") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!UUID.test(id) || !UUID.test(requestId) || !UUID.test(claimToken) || !moveId || !attachmentId || !SHA256.test(claimedHash)) return Response.json({ error: "Invalid upload identity" }, { status: 400 });
  if (request.headers.get("content-type")?.toLowerCase() !== "application/pdf") return Response.json({ error: "application/pdf is required" }, { status: 415 });
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) return Response.json({ error: "PDF exceeds 5 MiB" }, { status: 413 });

  const service = await createServiceClient();
  const [{ data: syncRequest, error: requestError }, { data: bill, error: billError }] = await Promise.all([
    service.from("odoo_sync_requests").select("id,kind,status,claim_token,payload").eq("id", requestId).maybeSingle(),
    service.from("payout_self_bills").select("id,status,payload_sha256,odoo_move_id,pdf_request_id,odoo_attachment_id,pdf_storage_path,pdf_sha256,pdf_size_bytes").eq("id", id).maybeSingle(),
  ]);
  if (requestError || billError) return Response.json({ error: "Could not validate upload" }, { status: 500 });
  const requestBill = syncRequest?.payload && typeof syncRequest.payload === "object" ? (syncRequest.payload as { bill?: Record<string, unknown> }).bill : null;
  if (!syncRequest || !bill || syncRequest.kind !== "payout_vendor_bill_pdf_export" || syncRequest.status !== "processing"
    || syncRequest.claim_token !== claimToken || bill.status !== "pdf_pending" || bill.pdf_request_id !== requestId
    || bill.odoo_move_id !== moveId || requestBill?.platform_bill_id !== id || requestBill.odoo_move_id !== moveId
    || requestBill.payload_sha256 !== bill.payload_sha256) {
    return Response.json({ error: "Stale or mismatched PDF request" }, { status: 409 });
  }

  const bytes = await readBoundedBody(request);
  if (!bytes || bytes.length === 0) return Response.json({ error: "PDF exceeds allowed size" }, { status: 413 });
  if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") return Response.json({ error: "Invalid PDF signature" }, { status: 415 });
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== claimedHash) return Response.json({ error: "PDF hash mismatch" }, { status: 400 });
  const objectPath = `${id}/${actualHash}.pdf`;
  const { error: uploadError } = await service.storage.from(BUCKET).upload(objectPath, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    const { data: stored } = await service.storage.from(BUCKET).download(objectPath);
    if (!stored || createHash("sha256").update(new Uint8Array(await stored.arrayBuffer())).digest("hex") !== actualHash) {
      return Response.json({ error: "Could not store PDF" }, { status: 500 });
    }
  }
  const { error: recordError } = await service.rpc("record_payout_self_bill_pdf", {
    p_self_bill_id: id,
    p_request_id: requestId,
    p_claim_token: claimToken,
    p_odoo_move_id: moveId,
    p_odoo_attachment_id: attachmentId,
    p_storage_path: objectPath,
    p_pdf_sha256: actualHash,
    p_pdf_size_bytes: bytes.length,
  });
  if (recordError) {
    if (recordError.code === "P0001") return Response.json({ error: recordError.message }, { status: 409 });
    return Response.json({ error: "Could not record PDF evidence" }, { status: 500 });
  }
  return Response.json({ accepted: true, pdf_storage_path: objectPath, pdf_sha256: actualHash, pdf_size_bytes: bytes.length });
}
