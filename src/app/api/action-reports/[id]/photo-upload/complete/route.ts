import { getSessionProfile } from "@/lib/auth/session";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let uploadedPath = "";
  try {
    const reportId = (await params).id;
    const body = await request.json() as { upload_id?: unknown; path?: unknown; mime_type?: unknown };
    const uploadId = typeof body.upload_id === "string" ? body.upload_id : "";
    uploadedPath = typeof body.path === "string" ? body.path : "";
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.split(";")[0] : "";
    const s = await createServiceClient();
    const report = await authorizedActionReport(s, actor, reportId);
    const prefix = `${report?.tenant_id ?? "platform"}/${reportId}/web-photo/`;
    if (!report || report.status !== "confirmed" || !/^[0-9a-f-]{36}$/i.test(uploadId) || !uploadedPath.startsWith(prefix) || !TYPES.has(mimeType)) {
      return Response.json({ error: "Invalid photo" }, { status: 400 });
    }
    const { data: info, error: infoError } = await s.storage.from("service-action-evidence").info(uploadedPath);
    if (infoError) {
      await s.rpc("cancel_service_action_photo_upload", { p_upload_id: uploadId, p_actor_id: actor.id });
      return Response.json({ error: "Uploaded photo was not found" }, { status: 400 });
    }
    const sizeBytes = Number(info.size);
    const storedType = String(info.contentType ?? info.metadata?.mimetype ?? "").split(";")[0];
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES || storedType !== mimeType) {
      await s.rpc("cancel_service_action_photo_upload", { p_upload_id: uploadId, p_actor_id: actor.id });
      await s.storage.from("service-action-evidence").remove([uploadedPath]);
      return Response.json({ error: "Stored photo validation failed" }, { status: 400 });
    }
    const { data, error } = await s.rpc("finalize_service_action_photo_upload", { p_upload_id: uploadId, p_actor_id: actor.id, p_storage_path: uploadedPath, p_mime_type: mimeType, p_size_bytes: sizeBytes });
    if (error) {
      if (/reservation (does not match|not found)|refill line not found/i.test(error.message)) {
        const { error: cancelError } = await s.rpc("cancel_service_action_photo_upload", { p_upload_id: uploadId, p_actor_id: actor.id });
        if (!cancelError) await s.storage.from("service-action-evidence").remove([uploadedPath]);
      }
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ attachment_id: data });
  } catch (error) {
    console.error("[action-report-photo-complete]", error);
    return Response.json({ error: "Unable to finalize photo" }, { status: 500 });
  }
}
