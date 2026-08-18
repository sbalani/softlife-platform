import { getSessionProfile } from "@/lib/auth/session";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reportId = (await params).id;
    const body = await request.json() as { mime_type?: unknown; size_bytes?: unknown };
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.split(";")[0] : "";
    const sizeBytes = Number(body.size_bytes);
    if (!TYPES[mimeType] || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 20 * 1024 * 1024) return Response.json({ error: "Unsupported audio" }, { status: 400 });
    const s = await createServiceClient();
    const report = await authorizedActionReport(s, actor, reportId, true);
    if (!report) return Response.json({ error: "Draft not found" }, { status: 404 });
    const { data: existingJob, error: jobError } = await s.from("service_action_ai_jobs").select("id").eq("report_id", reportId).maybeSingle();
    if (jobError) throw jobError;
    if (existingJob) return Response.json({ error: "This draft already has a voice AI workflow" }, { status: 409 });
    const path = `${report.tenant_id ?? "platform"}/${reportId}/audio/${crypto.randomUUID()}.${TYPES[mimeType]}`;
    const { data, error } = await s.storage.from("service-action-evidence").createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;
    return Response.json({ path: data.path, token: data.token, mime_type: mimeType });
  } catch (error) {
    console.error("[action-report-audio-upload]", error);
    return Response.json({ error: "Unable to create audio upload" }, { status: 500 });
  }
}
