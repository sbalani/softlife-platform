import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { authorizedMobileActionReport } from "@/lib/data/mobile-action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TYPES: Record<string, { extension: string; kind: "photo" | "audio" }> = {
  "image/jpeg": { extension: "jpg", kind: "photo" }, "image/png": { extension: "png", kind: "photo" },
  "image/webp": { extension: "webp", kind: "photo" }, "image/heic": { extension: "heic", kind: "photo" },
  "audio/webm": { extension: "webm", kind: "audio" }, "audio/mp4": { extension: "m4a", kind: "audio" },
  "audio/mpeg": { extension: "mp3", kind: "audio" }, "audio/wav": { extension: "wav", kind: "audio" },
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.attach")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    const reportId = (await params).id;
    if (!/^[0-9a-f-]{36}$/i.test(reportId)) return Response.json({ error: { message: "Invalid report ID" } }, { status: 400 });
    let body: { mime_type?: unknown; size_bytes?: unknown };
    try { body = await request.json(); } catch { return Response.json({ error: { code: "invalid_attachment", message: "Invalid JSON" } }, { status: 400 }); }
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.split(";")[0] : "";
    const config = TYPES[mimeType];
    const size = Number(body.size_bytes);
    if (!config || !Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024) return Response.json({ error: { message: "Unsupported attachment" } }, { status: 400 });
    const s = await createServiceClient();
    const report = await authorizedMobileActionReport(s, session, reportId);
    if (!report) return Response.json({ error: { code: "report_not_found", message: "Report not found or not accessible" } }, { status: 404 });
    if (report.status === "voided" || (config.kind === "audio" && report.status !== "draft")) {
      return Response.json({ error: { code: "report_state_conflict", message: "The Action Report no longer accepts this attachment" } }, { status: 409 });
    }
    if (config.kind === "audio") {
      const { data: existing, error: existingError } = await s.from("service_action_ai_jobs").select("id").eq("report_id", reportId).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return Response.json({ error: { message: "Voice workflow already exists" } }, { status: 409 });
    }
    const folder = `${report.tenant_id ?? "platform"}/${reportId}/mobile`;
    const { data: objects, error: listError } = await s.storage.from("service-action-evidence").list(folder, { limit: 21 });
    if (listError) return Response.json({ error: { code: "storage_unavailable", message: "Attachment storage unavailable" } }, { status: 502 });
    if ((objects?.length ?? 0) >= 20) return Response.json({ error: { message: "Attachment limit reached" } }, { status: 409 });
    const path = `${folder}/${crypto.randomUUID()}.${config.extension}`;
    const { data, error } = await s.storage.from("service-action-evidence").createSignedUploadUrl(path, { upsert: false });
    if (error) return Response.json({ error: { code: "storage_unavailable", message: "Attachment storage unavailable" } }, { status: 502 });
    return Response.json({ path: data.path, token: data.token, mime_type: mimeType, kind: config.kind, expires_in: 7200 });
  } catch (error) {
    console.error("[mobile-action-report-attachment-upload]", error);
    return Response.json({ error: { code: "internal_error", message: "Could not prepare attachment upload" } }, { status: 500 });
  }
}
