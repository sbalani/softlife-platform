"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState } from "react";
import { applyActionReportAiProposal, type ActionReportResult } from "@/app/actions/service-action-reports";
import { createClient } from "@/lib/supabase/client";

type AiStatus = {
  job: { id: string; attachment_id: string; status: string; transcript_text: string | null; extraction: Record<string, unknown> | null; last_error: string | null; reviewed_at: string | null } | null;
  questions: { id: string; question: string; status: string }[];
};

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];

export function ActionReportVoice({ reportId }: { reportId: string }) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [applyResult, applyAction, applying] = useActionState<ActionReportResult | null, FormData>(applyActionReportAiProposal, null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadStatus() {
    const response = await fetch(`/api/action-reports/${reportId}/ai-status`, { cache: "no-store" });
    if (response.ok) setStatus(await response.json() as AiStatus);
  }
  const pollStatus = useEffectEvent(loadStatus);

  useEffect(() => {
    queueMicrotask(() => { void pollStatus(); });
    const interval = setInterval(() => { void pollStatus(); }, 5000);
    return () => {
      clearInterval(interval);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [reportId]);

  async function upload(blob: Blob) {
    setUploading(true);
    setMessage("Uploading private audio...");
    try {
      if (blob.size <= 0 || blob.size > 20 * 1024 * 1024) throw new Error("Recording must be smaller than 20 MB.");
      const signedResponse = await fetch(`/api/action-reports/${reportId}/audio-upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mime_type: blob.type, size_bytes: blob.size }) });
      const signed = await signedResponse.json() as { path?: string; token?: string; mime_type?: string; error?: string };
      if (!signedResponse.ok || !signed.path || !signed.token || !signed.mime_type) throw new Error(signed.error ?? "Unable to authorize upload.");
      const supabase = createClient();
      const { error } = await supabase.storage.from("service-action-evidence").uploadToSignedUrl(signed.path, signed.token, blob, { contentType: signed.mime_type });
      if (error) throw error;
      const completeResponse = await fetch(`/api/action-reports/${reportId}/audio-upload/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: signed.path, mime_type: signed.mime_type }) });
      const completed = await completeResponse.json() as { error?: string };
      if (!completeResponse.ok) throw new Error(completed.error ?? "Unable to finalize audio.");
      setMessage("Audio queued for transcription and structured extraction.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setUploading(false); }
  }

  async function startRecording() {
    setMessage(null);
    const mimeType = MIME_TYPES.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) { setMessage("Audio recording is not supported in this browser. Use the file option instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        void upload(new Blob(chunksRef.current, { type: mimeType.split(";")[0] }));
      };
      recorder.start(1000);
      setRecording(true);
      stopTimerRef.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), 180_000);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Microphone permission was denied."); }
  }

  function stopRecording() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return <section className="rounded-xl border border-terracotta/30 bg-terracotta/5 p-4">
    <h3 className="font-display font-bold text-cocoa">Voice-assisted draft</h3>
    <p className="mt-1 text-xs text-taupe">Recording is stored privately, retained with this report, and sent to OpenAI for transcription and extraction. AI proposes fields only; it cannot confirm the report, select identifiers, or bypass your review.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {!recording ? <button type="button" onClick={startRecording} disabled={uploading} className="rounded-lg bg-cocoa px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Record voice note</button> : <button type="button" onClick={stopRecording} className="rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white">Stop recording</button>}
      <label className="cursor-pointer rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-cocoa"><input type="file" accept="audio/webm,audio/mp4,audio/mpeg,audio/wav" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />Upload audio file</label>
      {recording && <span className="text-sm font-semibold text-danger">Recording, maximum 3 minutes...</span>}
      {message && <span className="text-xs font-semibold text-taupe">{message}</span>}
    </div>
    {status?.job && <div className="mt-4 rounded-lg border border-line bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2"><span className="font-bold uppercase text-cocoa">AI {status.job.status.replaceAll("_", " ")}</span>{status.job.last_error && <span className="text-xs text-danger">{status.job.last_error}</span>}</div>
      <a href={`/api/action-reports/attachments/${status.job.attachment_id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-terracotta hover:underline">Play private source audio</a>
      {status.job.transcript_text && <details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-terracotta">Review transcript</summary><p className="mt-2 whitespace-pre-wrap text-xs text-taupe">{status.job.transcript_text}</p></details>}
      {status.questions.length > 0 && <div className="mt-3"><p className="text-xs font-bold uppercase text-warning">Needs clarification</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-cocoa">{status.questions.map((question) => <li key={question.id}>{question.question}</li>)}</ul></div>}
      {!status.job.reviewed_at && status.job.status !== "processing" && <label className="mt-3 flex items-center gap-1 text-xs text-taupe"><input type="checkbox" name="ignore_ai" value="yes" /> Continue manually and discard this AI workflow</label>}
      {status.job.status === "complete" && <div className="mt-3"><button type="button" onClick={() => { const data = new FormData(); data.set("report_id", reportId); data.set("job_id", status.job!.id); startTransition(() => applyAction(data)); }} disabled={applying || applyResult?.ok} className="rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{applying ? "Applying..." : "Apply AI suggestions to draft"}</button>{applyResult && !applyResult.ok && <span className="ml-3 text-xs text-danger">{applyResult.error}</span>}</div>}
    </div>}
  </section>;
}
