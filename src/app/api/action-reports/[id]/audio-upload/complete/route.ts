import { after } from "next/server";
import { getSessionProfile } from "@/lib/auth/session";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { runActionReportAiJobs } from "@/lib/action-report-ai";

export const runtime = "nodejs";
export const maxDuration = 300;

const TYPES = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reportId = (await params).id;
    const body = await request.json() as { path?: unknown; mime_type?: unknown };
    const path = typeof body.path === "string" ? body.path : "";
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.split(";")[0] : "";
    const s = await createServiceClient();
    const report = await authorizedActionReport(s, actor, reportId, true);
    if (!report) return Response.json({ error: "Draft not found" }, { status: 404 });
    const prefix = `${report.tenant_id ?? "platform"}/${reportId}/audio/`;
    if (!path.startsWith(prefix) || !TYPES.has(mimeType)) return Response.json({ error: "Invalid audio path" }, { status: 400 });
    const { data: info, error: infoError } = await s.storage.from("service-action-evidence").info(path);
    if (infoError) throw infoError;
    const sizeBytes = Number(info.size);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 20 * 1024 * 1024) return Response.json({ error: "Invalid audio size" }, { status: 400 });
    const storedType = String(info.contentType ?? info.metadata?.mimetype ?? "").split(";")[0];
    if (storedType !== mimeType) {
      await s.storage.from("service-action-evidence").remove([path]);
      return Response.json({ error: "Stored audio type does not match the upload" }, { status: 400 });
    }
    const { data, error } = await s.rpc("finalize_service_action_audio", { p_report_id: reportId, p_storage_path: path, p_mime_type: mimeType, p_size_bytes: sizeBytes, p_actor_id: actor.id });
    if (error) throw error;
    after(async () => {
      try { await runActionReportAiJobs(1); }
      catch (workerError) { console.error("[action-report-ai-after]", workerError); }
    });
    return Response.json(data);
  } catch (error) {
    console.error("[action-report-audio-complete]", error);
    return Response.json({ error: "Unable to finalize audio" }, { status: 500 });
  }
}
