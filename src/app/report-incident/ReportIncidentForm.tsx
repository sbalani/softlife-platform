"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MAX_REPORT_TOTAL_BYTES, PUBLIC_REPORT_BUCKET, publicReportFile } from "@/lib/public-reporting";

type Machine = { id: string; label: string };
type ApiError = { error?: string };

async function jsonResponse(response: Response) {
  const body = await response.json() as ApiError & Record<string, unknown>;
  if (!response.ok) throw new Error(body.error || "The report could not be submitted.");
  return body;
}

export function ReportIncidentForm({ machines }: { machines: Machine[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<File | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not supported by this browser. You can attach an audio file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const normalizedType = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
        const extension = normalizedType === "audio/mp4" ? "m4a" : "webm";
        const blob = new Blob(chunks, { type: normalizedType });
        if (blob.size) setRecordedAudio(new File([blob], `voice-note.${extension}`, { type: normalizedType }));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
        setRecording(false);
      };
      recorderRef.current = recorder;
      streamRef.current = stream;
      setRecordedAudio(null);
      setRecording(true);
      recorder.start();
      stopTimerRef.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), 180_000);
    } catch {
      setError("Microphone access was not available. You can attach an audio file instead.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const attachedAudio = data.get("audio") instanceof File && (data.get("audio") as File).size ? data.get("audio") as File : null;
    const audio = recordedAudio ?? attachedAudio;
    const media = data.getAll("media").filter((value): value is File => value instanceof File && value.size > 0);
    const explanation = String(data.get("explanation") ?? "").trim();
    if (!explanation && !audio) return setError("Explain the issue or attach one voice recording.");
    if (media.length > 5) return setError("You can attach at most five pictures or videos.");
    const files = [...(audio ? [audio] : []), ...media];
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_REPORT_TOTAL_BYTES) return setError("Attachments may total no more than 75 MB.");
    for (const file of files) {
      const check = publicReportFile(file.type, file.name, file.size);
      if ("error" in check) return setError(`${file.name}: ${check.error}`);
    }

    setPending(true);
    try {
      const draft = await jsonResponse(await fetch("/api/public-incident-reports/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine_id: data.get("machine_id"), reporter_name: data.get("reporter_name"), phone: data.get("phone"),
          email: data.get("email"), explanation, contact_consent: data.get("contact_consent") === "on", website: data.get("website"),
        }),
      }));
      const submissionId = String(draft.submission_id);
      const bearer = String(draft.token);
      const authorization = { authorization: `Bearer ${bearer}` };
      const storage = createClient().storage.from(PUBLIC_REPORT_BUCKET);

      for (const file of files) {
        const prepared = await jsonResponse(await fetch(`/api/public-incident-reports/${submissionId}/uploads`, {
          method: "POST", headers: { "content-type": "application/json", ...authorization },
          body: JSON.stringify({ mime_type: file.type, filename: file.name, size_bytes: file.size }),
        }));
        const { error: uploadError } = await storage.uploadToSignedUrl(String(prepared.path), String(prepared.token), file, { contentType: String(prepared.mime_type) });
        if (uploadError) throw uploadError;
        await jsonResponse(await fetch(`/api/public-incident-reports/${submissionId}/attachments`, {
          method: "POST", headers: { "content-type": "application/json", ...authorization },
          body: JSON.stringify({ attachment_id: prepared.attachment_id, path: prepared.path, mime_type: prepared.mime_type, kind: prepared.kind }),
        }));
      }
      await jsonResponse(await fetch(`/api/public-incident-reports/${submissionId}/submit`, { method: "POST", headers: authorization }));
      setSubmitted(true);
      setRecordedAudio(null);
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report could not be submitted.");
    } finally {
      setPending(false);
    }
  }

  if (submitted) return <div className="rounded-3xl border border-sage/30 bg-white p-8 text-center shadow-sm"><p className="font-display text-3xl font-bold text-cocoa">Thank you</p><p className="mt-3 text-sm text-taupe">Your report reached the SoftLife operations team. We may contact you using the details provided.</p><button type="button" onClick={() => setSubmitted(false)} className="mt-6 rounded-full border border-cocoa/20 px-5 py-2 text-sm font-bold text-cocoa">Send another report</button></div>;

  const input = "mt-1 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-cocoa outline-none transition focus:border-terracotta focus:ring-2 focus:ring-terracotta/15";
  return <form onSubmit={submit} className="space-y-6 rounded-3xl border border-cocoa/10 bg-white p-5 shadow-xl shadow-cocoa/5 sm:p-8">
    <div><label htmlFor="machine" className="text-sm font-bold text-cocoa">Which machine has the issue?</label><select id="machine" name="machine_id" required className={input}><option value="">Select the machine label</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.label}</option>)}</select></div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-cocoa">Your name<input required maxLength={120} name="reporter_name" autoComplete="name" className={input} /></label><div aria-hidden="true" className="absolute -left-[9999px]"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div><label className="text-sm font-bold text-cocoa">Phone<input maxLength={40} name="phone" type="tel" autoComplete="tel" className={input} /></label><label className="text-sm font-bold text-cocoa sm:col-start-2">Email<input maxLength={254} name="email" type="email" autoComplete="email" className={input} /></label></div>
    <p className="-mt-4 text-xs text-taupe">Enter at least a phone number or email address.</p>
    <label className="block text-sm font-bold text-cocoa">What happened?<textarea name="explanation" maxLength={4000} rows={5} placeholder="Describe what you saw, heard, or tried." className={input} /></label>
    <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-dashed border-terracotta/40 bg-cream/60 p-4 text-sm font-bold text-cocoa">Voice note or audio<span className="mt-1 block text-xs font-normal text-taupe">Optional if you wrote an explanation. Record up to 3 minutes or attach one audio file.</span><div className="mt-3 flex flex-wrap items-center gap-2">{recording ? <button type="button" onClick={stopRecording} className="rounded-full bg-danger px-3 py-2 text-xs font-bold text-white">Stop recording</button> : <button type="button" disabled={pending} onClick={startRecording} className="rounded-full bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Record voice note</button>}{recordedAudio && <><span className="text-xs font-normal text-sage">Voice note ready</span><button type="button" onClick={() => setRecordedAudio(null)} className="text-xs font-bold text-danger">Remove</button></>}</div><span className="mt-3 block text-xs font-normal text-taupe">Or attach audio:</span><input name="audio" disabled={recording || Boolean(recordedAudio)} type="file" accept="audio/webm,audio/mpeg,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/x-m4a" className="mt-2 block w-full text-xs text-taupe file:mr-3 file:rounded-full file:border-0 file:bg-terracotta file:px-3 file:py-2 file:font-bold file:text-white disabled:opacity-50" /></div><label className="rounded-2xl border border-dashed border-sage/40 bg-cream/60 p-4 text-sm font-bold text-cocoa">Pictures or videos<span className="mt-1 block text-xs font-normal text-taupe">Optional. Up to 5 files; images 4 MB, videos 50 MB.</span><input name="media" multiple type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,video/quicktime" className="mt-3 block w-full text-xs text-taupe file:mr-3 file:rounded-full file:border-0 file:bg-sage file:px-3 file:py-2 file:font-bold file:text-white" /></label></div>
    <label className="flex items-start gap-3 rounded-2xl bg-sand/60 p-4 text-sm text-cocoa"><input required name="contact_consent" type="checkbox" className="mt-1 h-4 w-4 accent-terracotta" /><span>I agree that SoftLife may contact me about this incident. <strong>This consent is required.</strong></span></label>
    {error && <p role="alert" className="rounded-xl bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">{error}</p>}
    <button disabled={pending || !machines.length} className="w-full rounded-xl bg-cocoa px-5 py-3.5 text-sm font-bold text-white transition hover:bg-terracotta disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Sending report..." : "Send report"}</button>
  </form>;
}
