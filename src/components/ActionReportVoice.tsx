"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState } from "react";
import { applyActionReportAiProposal, type ActionReportResult } from "@/app/actions/service-action-reports";
import { createClient } from "@/lib/supabase/client";

type AiStatus = {
  job: { id: string; attachment_id: string; purpose: "report" | "notes"; status: string; transcript_text: string | null; extraction: Record<string, unknown> | null; last_error: string | null; reviewed_at: string | null } | null;
  questions: { id: string; question: string; status: string }[];
};

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];

type StagedAudio = { blob: Blob; purpose: "report" | "notes" };

export function ActionReportVoice({ reportId, notesLength, onPendingChange, onTranscript }: { reportId: string | null; notesLength: number; onPendingChange: (pending: boolean) => void; onTranscript: (transcript: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [recordingPurpose, setRecordingPurpose] = useState<"report" | "notes">("report");
  const [staged, setStaged] = useState<StagedAudio | null>(null);
  const [transcriptApplied, setTranscriptApplied] = useState(false);
  const [applyResult, applyAction, applying] = useActionState<ActionReportResult | null, FormData>(applyActionReportAiProposal, null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadStatus() {
    if (!reportId) return;
    const response = await fetch(`/api/action-reports/${reportId}/ai-status`, { cache: "no-store" });
    if (response.ok) setStatus(await response.json() as AiStatus);
  }
  const pollStatus = useEffectEvent(loadStatus);

  useEffect(() => {
    if (reportId) queueMicrotask(() => { void pollStatus(); });
    const interval = reportId ? setInterval(() => { void pollStatus(); }, 5000) : null;
    return () => {
      if (interval) clearInterval(interval);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [reportId]);

  async function upload(blob: Blob, purpose: "report" | "notes") {
    if (!reportId) { setStaged({ blob, purpose }); return; }
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
      const completeResponse = await fetch(`/api/action-reports/${reportId}/audio-upload/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: signed.path, mime_type: signed.mime_type, purpose }) });
      const completed = await completeResponse.json() as { error?: string };
      if (!completeResponse.ok) throw new Error(completed.error ?? "Unable to finalize audio.");
      setMessage(purpose === "notes" ? "Audio queued for notes transcription." : "Audio queued for transcription and structured extraction.");
      setStaged(null);
      onPendingChange(false);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setUploading(false); }
  }

  const attachAfterDraftSave = useEffectEvent(() => {
    if (reportId && staged && !uploading) void upload(staged.blob, staged.purpose);
  });
  useEffect(() => {
    if (reportId) queueMicrotask(() => attachAfterDraftSave());
  }, [reportId]);

  async function startRecording(purpose: "report" | "notes") {
    setMessage(null);
    onPendingChange(true);
    const mimeType = MIME_TYPES.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) { onPendingChange(false); setMessage("Audio recording is not supported in this browser. Use the file option instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      setRecordingPurpose(purpose);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        const ready = { blob: new Blob(chunksRef.current, { type: mimeType.split(";")[0] }), purpose };
        setStaged(ready);
        setMessage(reportId ? "Recording ready; attaching to this draft..." : "Recording ready. It will attach only when you save the draft.");
        if (reportId) queueMicrotask(() => { void upload(ready.blob, ready.purpose); });
      };
      recorder.start(1000);
      onPendingChange(true);
      setRecording(true);
      stopTimerRef.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), 180_000);
    } catch (error) { onPendingChange(false); setMessage(error instanceof Error ? error.message : "Microphone permission was denied."); }
  }

  function stopRecording() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return <section className="rounded-xl border border-terracotta/30 bg-terracotta/5 p-4">
    <h3 className="font-display font-bold text-cocoa">Voice</h3>
    <p className="mt-1 text-xs text-taupe">Record before saving. Unsaved audio stays only in this browser tab and is discarded if you leave. Choose report assistance or notes-only transcription.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {!recording && !staged && !status?.job ? <><button type="button" onClick={() => startRecording("report")} disabled={uploading} className="rounded-lg bg-cocoa px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Record report voice note</button><button type="button" onClick={() => startRecording("notes")} disabled={uploading} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-cocoa disabled:opacity-50">Dictate notes</button></> : recording ? <button type="button" onClick={stopRecording} className="rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white">Stop recording</button> : null}
      {!staged && !status?.job && <label className="cursor-pointer rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-cocoa"><input type="file" accept="audio/webm,audio/mp4,audio/mpeg,audio/wav" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) { setStaged({ blob: file, purpose: "report" }); onPendingChange(true); } }} />Choose audio file</label>}
      {recording && <span className="text-sm font-semibold text-danger">Recording {recordingPurpose === "notes" ? "notes" : "report"}, maximum 3 minutes...</span>}
      {staged && reportId && <button type="button" onClick={() => { void upload(staged.blob, staged.purpose); }} disabled={uploading} className="rounded-lg bg-terracotta px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{uploading ? "Attaching..." : "Attach recording"}</button>}
      {staged && <button type="button" onClick={() => { setStaged(null); onPendingChange(false); setMessage("Unsaved recording discarded."); }} disabled={uploading} className="rounded-lg border border-danger/40 bg-white px-3 py-2 text-sm font-bold text-danger disabled:opacity-50">Discard recording</button>}
      {staged && !reportId && <span className="text-xs font-semibold text-warning">Save the draft when ready, then attach this recording.</span>}
      {message && <span className="text-xs font-semibold text-taupe">{message}</span>}
    </div>
    {transcriptApplied && <input type="hidden" name="ignore_ai" value="yes" />}
    {status?.job && <div className="mt-4 rounded-lg border border-line bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2"><span className="font-bold uppercase text-cocoa">AI {status.job.status.replaceAll("_", " ")}</span>{status.job.last_error && <span className="text-xs text-danger">{status.job.last_error}</span>}</div>
      <a href={`/api/action-reports/attachments/${status.job.attachment_id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-terracotta hover:underline">Play private source audio</a>
      {status.job.transcript_text && <details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-terracotta">Review transcript</summary><p className="mt-2 whitespace-pre-wrap text-xs text-taupe">{status.job.transcript_text}</p></details>}
      {status.job.purpose === "notes" && status.job.status === "complete" && status.job.transcript_text && !transcriptApplied && <button type="button" onClick={() => { const transcript = status.job!.transcript_text!; if (notesLength + transcript.length + (notesLength ? 2 : 0) > 5000) { setMessage("The transcript is too long for the remaining Notes space. Shorten the notes or transcript first."); return; } onTranscript(transcript); setTranscriptApplied(true); setMessage("Transcript added to notes. Review it before confirming."); }} className="mt-3 rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white">Add transcript to notes</button>}
      {status.questions.length > 0 && <div className="mt-3"><p className="text-xs font-bold uppercase text-warning">Needs clarification</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-cocoa">{status.questions.map((question) => <li key={question.id}>{question.question}</li>)}</ul></div>}
      {!status.job.reviewed_at && status.job.status !== "processing" && <label className="mt-3 flex items-center gap-1 text-xs text-taupe"><input type="checkbox" name="ignore_ai" value="yes" /> Continue manually and discard this AI workflow</label>}
      {status.job.purpose === "report" && status.job.status === "complete" && reportId && <div className="mt-3"><button type="button" onClick={() => { const data = new FormData(); data.set("report_id", reportId); data.set("job_id", status.job!.id); startTransition(() => applyAction(data)); }} disabled={applying || applyResult?.ok} className="rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{applying ? "Applying..." : "Apply AI suggestions to draft"}</button>{applyResult && !applyResult.ok && <span className="ml-3 text-xs text-danger">{applyResult.error}</span>}</div>}
    </div>}
  </section>;
}
