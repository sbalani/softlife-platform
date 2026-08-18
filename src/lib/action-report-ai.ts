import { openai } from "@ai-sdk/openai";
import { generateText, Output, transcribe } from "ai";
import { createServiceClient } from "@/lib/supabase/server";
import { actionReportExtractionSchema, actionReportQuestions } from "@/lib/action-report-ai-schema";

type ClaimedJob = { job_id: string; storage_path: string; mime_type: string; lease_token: string; attempt_count: number };

export async function runActionReportAiJobs(limit = 2) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI is not configured");
  const s = await createServiceClient();
  const worker = `vercel-${crypto.randomUUID()}`;
  const { data, error } = await s.rpc("claim_service_action_ai_jobs", { p_worker: worker, p_limit: limit });
  if (error) throw error;
  const jobs = (data as ClaimedJob[]) ?? [];
  const results: { jobId: string; status: string }[] = [];
  for (const job of jobs) {
    try {
      const { data: audio, error: downloadError } = await s.storage.from("service-action-evidence").download(job.storage_path);
      if (downloadError) throw downloadError;
      if (audio.size <= 0 || audio.size > 20 * 1024 * 1024) throw new Error("Audio object size is invalid");
      const transcript = await transcribe({
        model: openai.transcription("gpt-4o-mini-transcribe"),
        audio: await audio.arrayBuffer(),
        abortSignal: AbortSignal.timeout(120_000),
      });
      const generated = await generateText({
        model: openai("gpt-4o-mini"),
        output: Output.object({ schema: actionReportExtractionSchema }),
        instructions: "Extract only physical service facts explicitly stated in the transcript. Never invent identifiers, lots, quantities, units, cleaning evidence, warehouses, machines, or users. Use null for missing or ambiguous values. Preserve spoken lot codes exactly.",
        prompt: transcript.text,
        abortSignal: AbortSignal.timeout(120_000),
      });
      if (!generated.output) throw new Error("AI extraction returned no output");
      const extraction = generated.output;
      const questions = actionReportQuestions(extraction);
      const { error: completeError } = await s.rpc("complete_service_action_ai_job", {
        p_job_id: job.job_id,
        p_worker: worker,
        p_lease_token: job.lease_token,
        p_transcript: transcript.text,
        p_segments: transcript.segments,
        p_language: transcript.language ?? null,
        p_duration: transcript.durationInSeconds ?? null,
        p_extraction: extraction,
        p_questions: questions,
        p_transcription_model: "gpt-4o-mini-transcribe",
        p_extraction_model: "gpt-4o-mini",
      });
      if (completeError) throw completeError;
      results.push({ jobId: job.job_id, status: "complete" });
    } catch (jobError) {
      const retryAt = job.attempt_count < 3 ? new Date(Date.now() + 5 * 60_000).toISOString() : null;
      const { error: failError } = await s.rpc("fail_service_action_ai_job", {
        p_job_id: job.job_id,
        p_worker: worker,
        p_lease_token: job.lease_token,
        p_error: jobError instanceof Error ? jobError.message : String(jobError),
        p_retry_at: retryAt,
      });
      if (failError) console.error("[action-report-ai] Unable to fail job", job.job_id, failError.message);
      results.push({ jobId: job.job_id, status: retryAt ? "retry_wait" : "failed" });
    }
  }
  return { claimed: jobs.length, results };
}
