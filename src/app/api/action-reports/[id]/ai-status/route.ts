import { getSessionProfile } from "@/lib/auth/session";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reportId = (await params).id;
    const s = await createServiceClient();
    if (!await authorizedActionReport(s, actor, reportId)) return Response.json({ error: "Report not found" }, { status: 404 });
    const [{ data: job, error: jobError }, { data: questions, error: questionError }] = await Promise.all([
      s.from("service_action_ai_jobs").select("id,attachment_id,status,transcript_text,extraction,last_error,reviewed_at,updated_at").eq("report_id", reportId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      s.from("service_action_questions").select("id,question,question_key,status,answer").eq("report_id", reportId).eq("source", "deterministic_ai_review").order("created_at"),
    ]);
    if (jobError) throw jobError;
    if (questionError) throw questionError;
    return Response.json({ job, questions: questions ?? [] });
  } catch (error) {
    console.error("[action-report-ai-status]", error);
    return Response.json({ error: "Unable to load AI status" }, { status: 500 });
  }
}
