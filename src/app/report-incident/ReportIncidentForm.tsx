"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/lib/i18n/locale";
import { MAX_REPORT_TOTAL_BYTES, PUBLIC_REPORT_BUCKET, publicReportFile } from "@/lib/public-reporting";

type Machine = { id: string; label: string };
type ApiError = { error?: string };

const COPY = {
  en: {
    genericError: "The report could not be submitted.", unsupportedRecording: "Voice recording is not supported by this browser. You can attach an audio file instead.", microphoneError: "Microphone access was not available. You can attach an audio file instead.",
    explanationRequired: "Explain the issue or attach one voice recording.", tooManyMedia: "You can attach at most five pictures or videos.", attachmentsTooLarge: "Attachments may total no more than 75 MB.", unsupportedFile: "Unsupported attachment type.", fileTooLarge: "This file is too large.",
    thankYou: "Thank you", received: "Your report reached the SoftLife operations team. We may contact you using the details provided.", another: "Send another report",
    machineQuestion: "Which machine has the issue?", machinePlaceholder: "Select the machine location", qrSelected: "Location selected from the QR code. You can change it if needed.", name: "Your name", website: "Website", phone: "Phone", email: "Email", contactRequired: "Enter at least a phone number or email address.",
    happened: "What happened?", explanationPlaceholder: "Describe what you saw, heard, or tried.", audio: "Voice note or audio", audioHelp: "Optional if you wrote an explanation. Record up to 3 minutes or attach one audio file.", stop: "Stop recording", record: "Record voice note", ready: "Voice note ready", remove: "Remove", attachAudio: "Or attach audio:",
    media: "Pictures or videos", mediaHelp: "Optional. Up to 5 files; images 4 MB, videos 50 MB.", consent: "I agree that SoftLife may contact me about this incident.", consentRequired: "This consent is required.", sending: "Sending report...", send: "Send report",
    unavailable: "Incident reporting is temporarily unavailable. Please contact SoftLife directly.",
  },
  es: {
    genericError: "No se pudo enviar la incidencia.", unsupportedRecording: "Este navegador no permite grabar notas de voz. Puedes adjuntar un archivo de audio.", microphoneError: "No se pudo acceder al micrófono. Puedes adjuntar un archivo de audio.",
    explanationRequired: "Explica la incidencia o adjunta una nota de voz.", tooManyMedia: "Puedes adjuntar un máximo de cinco fotos o vídeos.", attachmentsTooLarge: "Los archivos adjuntos no pueden superar los 75 MB en total.", unsupportedFile: "El tipo de archivo adjunto no es compatible.", fileTooLarge: "Este archivo es demasiado grande.",
    thankYou: "Gracias", received: "El equipo de operaciones de SoftLife ha recibido tu incidencia. Es posible que contactemos contigo mediante los datos facilitados.", another: "Enviar otra incidencia",
    machineQuestion: "¿En qué ubicación está la máquina con la incidencia?", machinePlaceholder: "Selecciona la ubicación de la máquina", qrSelected: "Ubicación seleccionada mediante el código QR. Puedes cambiarla si es necesario.", name: "Tu nombre", website: "Sitio web", phone: "Teléfono", email: "Email", contactRequired: "Introduce al menos un número de teléfono o un email.",
    happened: "¿Qué ha ocurrido?", explanationPlaceholder: "Describe lo que has visto, oído o intentado hacer.", audio: "Nota de voz o audio", audioHelp: "Opcional si has escrito una explicación. Graba hasta 3 minutos o adjunta un archivo de audio.", stop: "Detener grabación", record: "Grabar nota de voz", ready: "Nota de voz lista", remove: "Eliminar", attachAudio: "O adjunta un audio:",
    media: "Fotos o vídeos", mediaHelp: "Opcional. Hasta 5 archivos; imágenes de 4 MB y vídeos de 50 MB.", consent: "Acepto que SoftLife contacte conmigo en relación con esta incidencia.", consentRequired: "Este consentimiento es obligatorio.", sending: "Enviando incidencia...", send: "Enviar incidencia",
    unavailable: "El formulario de incidencias no está disponible temporalmente. Contacta directamente con SoftLife.",
  },
} as const;

async function jsonResponse(response: Response, locale: Locale) {
  const body = await response.json() as ApiError & Record<string, unknown>;
  if (!response.ok) throw new Error(locale === "es" ? COPY.es.genericError : body.error || COPY.en.genericError);
  return body;
}

export function ReportIncidentForm({ machines, locale, initialMachineId }: { machines: Machine[]; locale: Locale; initialMachineId?: string }) {
  const text = COPY[locale];
  const [availableMachines, setAvailableMachines] = useState(machines);
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

  useEffect(() => {
    let active = true;
    async function refreshMachines() {
      try {
        const response = await fetch(`/api/public-incident-reports/machines?locale=${locale}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { machines?: Machine[] };
        if (active && Array.isArray(body.machines)) setAvailableMachines(body.machines);
      } catch { /* Keep the last successful list during transient failures. */ }
    }
    void refreshMachines();
    const interval = setInterval(refreshMachines, 15_000);
    const refreshVisible = () => { if (document.visibilityState === "visible") void refreshMachines(); };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [locale]);

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(text.unsupportedRecording);
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
      setError(text.microphoneError);
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
    if (!explanation && !audio) return setError(text.explanationRequired);
    if (media.length > 5) return setError(text.tooManyMedia);
    const files = [...(audio ? [audio] : []), ...media];
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_REPORT_TOTAL_BYTES) return setError(text.attachmentsTooLarge);
    for (const file of files) {
      const check = publicReportFile(file.type, file.name, file.size);
      if ("error" in check) return setError(`${file.name}: ${check.error === "Unsupported attachment type." ? text.unsupportedFile : text.fileTooLarge}`);
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
      }), locale);
      const submissionId = String(draft.submission_id);
      const bearer = String(draft.token);
      const authorization = { authorization: `Bearer ${bearer}` };
      const storage = createClient().storage.from(PUBLIC_REPORT_BUCKET);

      for (const file of files) {
        const prepared = await jsonResponse(await fetch(`/api/public-incident-reports/${submissionId}/uploads`, {
          method: "POST", headers: { "content-type": "application/json", ...authorization },
          body: JSON.stringify({ mime_type: file.type, filename: file.name, size_bytes: file.size }),
        }), locale);
        const { error: uploadError } = await storage.uploadToSignedUrl(String(prepared.path), String(prepared.token), file, { contentType: String(prepared.mime_type) });
        if (uploadError) throw uploadError;
        await jsonResponse(await fetch(`/api/public-incident-reports/${submissionId}/attachments`, {
          method: "POST", headers: { "content-type": "application/json", ...authorization },
          body: JSON.stringify({ attachment_id: prepared.attachment_id, path: prepared.path, mime_type: prepared.mime_type, kind: prepared.kind }),
        }), locale);
      }
      await jsonResponse(await fetch(`/api/public-incident-reports/${submissionId}/submit`, { method: "POST", headers: authorization }), locale);
      setSubmitted(true);
      setRecordedAudio(null);
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.genericError);
    } finally {
      setPending(false);
    }
  }

  if (submitted) return <div className="rounded-3xl border border-sage/30 bg-white p-8 text-center shadow-sm"><p className="font-display text-3xl font-bold text-cocoa">{text.thankYou}</p><p className="mt-3 text-sm text-taupe">{text.received}</p><button type="button" onClick={() => setSubmitted(false)} className="mt-6 rounded-full border border-cocoa/20 px-5 py-2 text-sm font-bold text-cocoa">{text.another}</button></div>;
  if (!availableMachines.length) return <p className="rounded-2xl border border-warning/30 bg-white p-6 text-sm font-semibold text-warning">{text.unavailable}</p>;

  const input = "mt-1 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-cocoa outline-none transition focus:border-terracotta focus:ring-2 focus:ring-terracotta/15";
  return <form onSubmit={submit} className="space-y-6 rounded-3xl border border-cocoa/10 bg-white p-5 shadow-xl shadow-cocoa/5 sm:p-8">
    <div><label htmlFor="machine" className="text-sm font-bold text-cocoa">{text.machineQuestion}</label><select id="machine" name="machine_id" required defaultValue={initialMachineId ?? ""} className={input}><option value="">{text.machinePlaceholder}</option>{availableMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.label}</option>)}</select>{initialMachineId && <p className="mt-2 text-xs font-medium text-sage">{text.qrSelected}</p>}</div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-cocoa">{text.name}<input required maxLength={120} name="reporter_name" autoComplete="name" className={input} /></label><div aria-hidden="true" className="absolute -left-[9999px]"><label>{text.website}<input name="website" tabIndex={-1} autoComplete="off" /></label></div><label className="text-sm font-bold text-cocoa">{text.phone}<input maxLength={40} name="phone" type="tel" autoComplete="tel" className={input} /></label><label className="text-sm font-bold text-cocoa sm:col-start-2">{text.email}<input maxLength={254} name="email" type="email" autoComplete="email" className={input} /></label></div>
    <p className="-mt-4 text-xs text-taupe">{text.contactRequired}</p>
    <label className="block text-sm font-bold text-cocoa">{text.happened}<textarea name="explanation" maxLength={4000} rows={5} placeholder={text.explanationPlaceholder} className={input} /></label>
    <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-dashed border-terracotta/40 bg-cream/60 p-4 text-sm font-bold text-cocoa">{text.audio}<span className="mt-1 block text-xs font-normal text-taupe">{text.audioHelp}</span><div className="mt-3 flex flex-wrap items-center gap-2">{recording ? <button type="button" onClick={stopRecording} className="rounded-full bg-danger px-3 py-2 text-xs font-bold text-white">{text.stop}</button> : <button type="button" disabled={pending} onClick={startRecording} className="rounded-full bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{text.record}</button>}{recordedAudio && <><span className="text-xs font-normal text-sage">{text.ready}</span><button type="button" onClick={() => setRecordedAudio(null)} className="text-xs font-bold text-danger">{text.remove}</button></>}</div><span className="mt-3 block text-xs font-normal text-taupe">{text.attachAudio}</span><input name="audio" disabled={recording || Boolean(recordedAudio)} type="file" accept="audio/webm,audio/mpeg,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/x-m4a" className="mt-2 block w-full text-xs text-taupe file:mr-3 file:rounded-full file:border-0 file:bg-terracotta file:px-3 file:py-2 file:font-bold file:text-white disabled:opacity-50" /></div><label className="rounded-2xl border border-dashed border-sage/40 bg-cream/60 p-4 text-sm font-bold text-cocoa">{text.media}<span className="mt-1 block text-xs font-normal text-taupe">{text.mediaHelp}</span><input name="media" multiple type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,video/quicktime" className="mt-3 block w-full text-xs text-taupe file:mr-3 file:rounded-full file:border-0 file:bg-sage file:px-3 file:py-2 file:font-bold file:text-white" /></label></div>
    <label className="flex items-start gap-3 rounded-2xl bg-sand/60 p-4 text-sm text-cocoa"><input required name="contact_consent" type="checkbox" className="mt-1 h-4 w-4 accent-terracotta" /><span>{text.consent} <strong>{text.consentRequired}</strong></span></label>
    {error && <p role="alert" className="rounded-xl bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">{error}</p>}
    <button disabled={pending} className="w-full rounded-xl bg-cocoa px-5 py-3.5 text-sm font-bold text-white transition hover:bg-terracotta disabled:cursor-not-allowed disabled:opacity-50">{pending ? text.sending : text.send}</button>
  </form>;
}
