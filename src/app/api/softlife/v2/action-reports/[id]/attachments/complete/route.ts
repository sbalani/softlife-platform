import { after } from "next/server";
import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { runActionReportAiJobs } from "@/lib/action-report-ai";
import { actionReportAttachmentError } from "@/lib/action-report-attachment-errors";
import { authorizedMobileActionReport } from "@/lib/data/mobile-action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const TYPES: Record<string, "photo" | "audio"> = { "image/jpeg": "photo", "image/png": "photo", "image/webp": "photo", "image/heic": "photo", "audio/webm": "audio", "audio/mp4": "audio", "audio/mpeg": "audio", "audio/wav": "audio" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.attach")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    const reportId = (await params).id;
    if (!/^[0-9a-f-]{36}$/i.test(reportId)) return Response.json({ error: { message: "Invalid report ID" } }, { status: 400 });
    let body: { path?: unknown; mime_type?: unknown; refill_line_id?: unknown; purpose?: unknown };
    try { body = await request.json(); } catch { return Response.json({ error: { code: "invalid_attachment", message: "Invalid JSON" } }, { status: 400 }); }
    const path = typeof body.path === "string" ? body.path : "";
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.split(";")[0] : "";
    const kind = TYPES[mimeType];
    const s = await createServiceClient();
    const report = await authorizedMobileActionReport(s, session, reportId);
    const prefix = `${report?.tenant_id ?? "platform"}/${reportId}/mobile/`;
    if (!report) return Response.json({ error: { code: "report_not_found", message: "Report not found or not accessible" } }, { status: 404 });
    if (!kind || !path.startsWith(prefix)) return Response.json({ error: { code: "invalid_attachment", message: "Invalid attachment" } }, { status: 400 });
    if (report.status === "voided") return Response.json({ error: { code: "report_state_conflict", message: "The Action Report no longer accepts this attachment" } }, { status: 409 });
    if (kind === "audio" && report.status !== "draft") {
      await s.storage.from("service-action-evidence").remove([path]);
      return Response.json({ error: { code: "report_state_conflict", message: "Audio can only be attached to a draft" } }, { status: 409 });
    }
    const { data: info, error: infoError } = await s.storage.from("service-action-evidence").info(path);
    if (infoError) {
      const missing = infoError.message.toLowerCase().includes("not found");
      return Response.json({ error: { code: missing ? "uploaded_object_not_found" : "storage_unavailable", message: missing ? "Uploaded attachment not found" : "Attachment storage unavailable" } }, { status: missing ? 400 : 502 });
    }
    const size = Number(info.size);
    const storedType = String(info.contentType ?? info.metadata?.mimetype ?? "").split(";")[0];
    if (!Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024 || storedType !== mimeType) {
      await s.storage.from("service-action-evidence").remove([path]);
      return Response.json({ error: { message: "Stored attachment validation failed" } }, { status: 400 });
    }
    if (kind === "audio") {
      const purpose = body.purpose === "notes" ? "notes" : body.purpose === "report" || body.purpose === undefined ? "report" : null;
      if (!purpose) {
        await s.storage.from("service-action-evidence").remove([path]);
        return Response.json({ error: { message: "Invalid voice purpose" } }, { status: 400 });
      }
      const { data, error } = await s.rpc("finalize_service_action_audio", { p_report_id: reportId, p_storage_path: path, p_mime_type: mimeType, p_size_bytes: size, p_actor_id: session.id, p_purpose: purpose });
      if (error) {
        const mapped = actionReportAttachmentError(error);
        return Response.json({ error: { code: mapped.code, message: mapped.message } }, { status: mapped.status });
      }
      after(async () => { try { await runActionReportAiJobs(1); } catch (error) { console.error("[mobile-action-report-ai-after]", error); } });
      return Response.json(data);
    }
    const refillLineId = typeof body.refill_line_id === "string" ? body.refill_line_id : null;
    if (refillLineId) {
      const { data: line, error: lineError } = await s.from("service_action_refill_lines").select("id").eq("id", refillLineId).eq("report_id", reportId).maybeSingle();
      if (lineError) throw lineError;
      if (!line) return Response.json({ error: { code: "refill_line_conflict", message: "The refill line changed; refresh the draft and try again" } }, { status: 409 });
    }
    const { data, error } = await s.rpc("finalize_unreserved_service_action_photo", { p_report_id: reportId, p_actor_id: session.id, p_storage_path: path, p_mime_type: mimeType, p_size_bytes: size, p_refill_line_id: refillLineId });
    if (error) {
      const mapped = actionReportAttachmentError(error);
      return Response.json({ error: { code: mapped.code, message: mapped.message } }, { status: mapped.status });
    }
    return Response.json({ attachment_id: data });
  } catch (error) {
    console.error("[mobile-action-report-attachment-complete]", error);
    return Response.json({ error: { code: "internal_error", message: "Could not complete attachment" } }, { status: 500 });
  }
}
