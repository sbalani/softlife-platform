import { getSessionProfile } from "@/lib/auth/session";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
};
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reportId = (await params).id;
    const body = await request.json() as { mime_type?: unknown; size_bytes?: unknown; line_number?: unknown };
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.split(";")[0] : "";
    const sizeBytes = Number(body.size_bytes);
    const lineNumber = body.line_number === null || body.line_number === undefined ? null : Number(body.line_number);
    if (!TYPES[mimeType] || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES) return Response.json({ error: "Unsupported photo" }, { status: 400 });
    if (lineNumber !== null && (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > 20)) return Response.json({ error: "Invalid refill line" }, { status: 400 });
    const s = await createServiceClient();
    const report = await authorizedActionReport(s, actor, reportId);
    if (!report || report.status !== "confirmed") return Response.json({ error: "Confirmed report not found" }, { status: 404 });
    const folder = `${report.tenant_id ?? "platform"}/${reportId}/web-photo`;
    const [{ data: objects, error: listError }, { data: reservations, error: reservationListError }, { data: attachments, error: attachmentError }] = await Promise.all([
      s.storage.from("service-action-evidence").list(folder, { limit: 100 }),
      s.from("service_action_photo_uploads").select("id,storage_path,expires_at,completed_attachment_id").eq("report_id", reportId),
      s.from("service_action_attachments").select("storage_path").eq("report_id", reportId).eq("kind", "photo").like("storage_path", `${folder}/%`),
    ]);
    if (listError || reservationListError || attachmentError) throw listError ?? reservationListError ?? attachmentError;
    const now = Date.now();
    const retainedPaths = new Set([...(attachments ?? []).map((item) => item.storage_path), ...(reservations ?? []).filter((item) => item.completed_attachment_id || Date.parse(item.expires_at) > now).map((item) => item.storage_path)]);
    const orphanPaths = (objects ?? []).map((item) => `${folder}/${item.name}`).filter((path) => !retainedPaths.has(path));
    if (orphanPaths.length) await s.storage.from("service-action-evidence").remove(orphanPaths);
    const expiredIds = (reservations ?? []).filter((item) => !item.completed_attachment_id && Date.parse(item.expires_at) <= now).map((item) => item.id);
    if (expiredIds.length) await s.from("service_action_photo_uploads").delete().in("id", expiredIds);
    const path = `${folder}/${crypto.randomUUID()}.${TYPES[mimeType]}`;
    const { data: uploadId, error: reservationError } = await s.rpc("reserve_service_action_photo_upload", { p_report_id: reportId, p_actor_id: actor.id, p_storage_path: path, p_mime_type: mimeType, p_expected_size_bytes: sizeBytes, p_line_number: lineNumber });
    if (reservationError) return Response.json({ error: reservationError.message }, { status: reservationError.message.includes("limit") ? 409 : 400 });
    const { data, error } = await s.storage.from("service-action-evidence").createSignedUploadUrl(path, { upsert: false });
    if (error) {
      await s.from("service_action_photo_uploads").delete().eq("id", uploadId);
      throw error;
    }
    return Response.json({ upload_id: uploadId, path: data.path, token: data.token, mime_type: mimeType });
  } catch (error) {
    console.error("[action-report-photo-upload]", error);
    return Response.json({ error: "Unable to authorize photo upload" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reportId = (await params).id;
    const body = await request.json() as { upload_id?: unknown };
    const uploadId = typeof body.upload_id === "string" ? body.upload_id : "";
    const s = await createServiceClient();
    const { data: upload, error } = await s.from("service_action_photo_uploads").select("report_id").eq("id", uploadId).maybeSingle();
    if (error) throw error;
    if (!upload || upload.report_id !== reportId) return Response.json({ error: "Upload reservation not found" }, { status: 404 });
    const { data: path, error: cancelError } = await s.rpc("cancel_service_action_photo_upload", { p_upload_id: uploadId, p_actor_id: actor.id });
    if (cancelError) {
      if (cancelError.message.includes("already complete")) return Response.json({ cancelled: false, completed: true });
      return Response.json({ error: cancelError.message }, { status: 409 });
    }
    await s.storage.from("service-action-evidence").remove([path]);
    return Response.json({ cancelled: true });
  } catch (error) {
    console.error("[action-report-photo-cancel]", error);
    return Response.json({ error: "Unable to cancel photo upload" }, { status: 500 });
  }
}
