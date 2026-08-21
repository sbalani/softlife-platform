import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { authorizedMobileActionReport } from "@/lib/data/mobile-action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function context(request: Request, reportId: string) {
  if (!isSupabaseConfigured()) return null;
  const session = await getApiSession(request);
  if (!session || !hasMobileCapability(session, "action_reports.write")) return null;
  const s = await createServiceClient();
  const report = await authorizedMobileActionReport(s, session, reportId);
  return report ? { session, s, report } : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reportId = (await params).id;
  const ctx = await context(request, reportId);
  if (!ctx) return Response.json({ error: { message: "Unauthorized or not found" } }, { status: 404 });
  const [{ data: job, error }, { data: questions, error: questionError }] = await Promise.all([
    ctx.s.from("service_action_ai_jobs").select("id,attachment_id,purpose,status,transcript_text,transcript_language,duration_seconds,extraction,last_error,reviewed_at,updated_at").eq("report_id", reportId).maybeSingle(),
    ctx.s.from("service_action_questions").select("id,question_key,question,status,answer").eq("report_id", reportId).eq("source", "deterministic_ai_review").order("created_at"),
  ]);
  if (error || questionError) return Response.json({ error: { message: error?.message ?? questionError?.message } }, { status: 500 });
  return Response.json({ job, questions: questions ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reportId = (await params).id;
  const ctx = await context(request, reportId);
  if (!ctx || ctx.report.status !== "draft") return Response.json({ error: { message: "Unauthorized or draft not found" } }, { status: 404 });
  try {
    const body = await request.json() as { decision?: unknown; answers?: unknown };
    const decision = body.decision === "reviewed" ? "reviewed" : body.decision === "discard" ? "discard" : null;
    if (!decision) return Response.json({ error: { message: "Invalid review decision" } }, { status: 400 });
    const { data: job, error } = await ctx.s.from("service_action_ai_jobs").select("id,status").eq("report_id", reportId).maybeSingle();
    if (error) throw error;
    if (!job) return Response.json({ error: { message: "AI job not found" } }, { status: 404 });
    if (job.status === "processing") return Response.json({ error: { message: "AI processing is active" } }, { status: 409 });
    const now = new Date().toISOString();
    if (decision === "discard") {
      const update = job.status === "complete" ? { reviewed_by: ctx.session.id, reviewed_at: now } : { status: "failed", last_error: "Discarded by mobile user", reviewed_by: ctx.session.id, reviewed_at: now };
      const { error: updateError } = await ctx.s.from("service_action_ai_jobs").update(update).eq("id", job.id);
      if (updateError) throw updateError;
      await ctx.s.from("service_action_questions").update({ status: "dismissed" }).eq("ai_job_id", job.id).eq("status", "open");
      return Response.json({ ok: true, decision });
    }
    if (job.status !== "complete") return Response.json({ error: { message: "AI extraction is not complete" } }, { status: 409 });
    const answers = body.answers && typeof body.answers === "object" ? body.answers as Record<string, unknown> : {};
    const { data: openQuestions, error: openError } = await ctx.s.from("service_action_questions").select("id,question_key").eq("ai_job_id", job.id).eq("status", "open");
    if (openError) throw openError;
    for (const question of openQuestions ?? []) {
      const answer = String(answers[String(question.question_key)] ?? "").trim().slice(0, 1000);
      if (!answer) return Response.json({ error: { message: `Answer required: ${question.question_key}` } }, { status: 400 });
      const { error: answerError } = await ctx.s.from("service_action_questions").update({ answer, status: "answered", answered_at: now }).eq("id", question.id);
      if (answerError) throw answerError;
    }
    const { error: reviewError } = await ctx.s.from("service_action_ai_jobs").update({ reviewed_by: ctx.session.id, reviewed_at: now }).eq("id", job.id);
    if (reviewError) throw reviewError;
    return Response.json({ ok: true, decision });
  } catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 }); }
}
