import { after } from "next/server";
import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { runActionReportAiJobs } from "@/lib/action-report-ai";
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
    const body = await request.json() as { path?: unknown; mime_type?: unknown; refill_line_id?: unknown };
    const path = typeof body.path === "string" ? body.path : "";
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.split(";")[0] : "";
    const kind = TYPES[mimeType];
    const s = await createServiceClient();
    const report = await authorizedMobileActionReport(s, session, reportId);
    const prefix = `${report?.tenant_id ?? "platform"}/${reportId}/mobile/`;
    if (!report || !kind || !path.startsWith(prefix) || (kind === "audio" && report.status !== "draft")) return Response.json({ error: { message: "Invalid attachment" } }, { status: 400 });
    const { data: info, error: infoError } = await s.storage.from("service-action-evidence").info(path);
    if (infoError) throw infoError;
    const size = Number(info.size);
    const storedType = String(info.contentType ?? info.metadata?.mimetype ?? "").split(";")[0];
    if (!Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024 || storedType !== mimeType) return Response.json({ error: { message: "Stored attachment validation failed" } }, { status: 400 });
    if (kind === "audio") {
      const { data, error } = await s.rpc("finalize_service_action_audio", { p_report_id: reportId, p_storage_path: path, p_mime_type: mimeType, p_size_bytes: size, p_actor_id: session.id });
      if (error) throw error;
      after(async () => { try { await runActionReportAiJobs(1); } catch (error) { console.error("[mobile-action-report-ai-after]", error); } });
      return Response.json(data);
    }
    const refillLineId = typeof body.refill_line_id === "string" ? body.refill_line_id : null;
    if (refillLineId) {
      const { data: line } = await s.from("service_action_refill_lines").select("id").eq("id", refillLineId).eq("report_id", reportId).maybeSingle();
      if (!line) return Response.json({ error: { message: "Refill line not found" } }, { status: 400 });
    }
    const { data, error } = await s.from("service_action_attachments").upsert({ report_id: reportId, refill_line_id: refillLineId, kind: "photo", storage_path: path, mime_type: mimeType, size_bytes: size, created_by: session.id }, { onConflict: "storage_path" }).select("id").single();
    if (error) throw error;
    return Response.json({ attachment_id: data.id });
  } catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 }); }
}
