"use client";

import { useActionState, useEffect, useEffectEvent, useRef, useState } from "react";
import Image from "next/image";
import {
  submitQrActionReport,
  submitWebActionReport,
  type ActionReportResult,
} from "@/app/actions/service-action-reports";
import type { ActionReportDraft } from "@/lib/data/action-reports";
import { ActionReportVoice } from "@/components/ActionReportVoice";
import { ACTION_REPORT_MODES, initialActionReportModes, type ActionReportMode } from "@/lib/action-report-modes";
import { createClient } from "@/lib/supabase/client";

export type ActionReportMachine = { id: string; name: string; warehouseId: number | null };
export type ActionReportLot = {
  odooId: number;
  name: string;
  productName: string;
  available: number;
  warehouseId: number;
};
export type ActionReportIncident = { id: string; machineId: string; title: string; severity: "info" | "warning" | "critical"; typeLabel: string };

type LineDraft = { key: string; lotId: string; lotCode: string; productName: string; quantity: number | null; unit: string };
type StagedPhoto = { id: string; file: File; lineKey: string | null; uploaded?: { uploadId: string; path: string; token: string; mimeType: string; stored: boolean } };
const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-taupe";
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function localDateTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function newLine(lotId = ""): LineDraft {
  return { key: crypto.randomUUID(), lotId, lotCode: "", productName: "", quantity: null, unit: "unit" };
}

function PhotoPreview({ file }: { file: File }) {
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <a href={url} target="_blank" rel="noreferrer" className="relative mt-2 block h-72 overflow-hidden rounded-lg border border-line bg-white sm:h-96">
      <Image src={url} alt={`Selected batch code photo: ${file.name}`} fill unoptimized className="object-contain" />
      <span className="absolute right-2 bottom-2 rounded-md bg-cocoa/80 px-2 py-1 text-[10px] font-bold text-white">Tap to enlarge</span>
    </a>
  );
}

export function ActionReportForm({
  machines,
  lots,
  source = "web",
  initialEventTime,
  initialDraft,
  incidents = [],
  initialMachineId,
  initialIncidentIds = [],
  initialModes,
}: {
  machines: ActionReportMachine[];
  lots: ActionReportLot[];
  source?: "web" | "machine_qr";
  initialEventTime: string;
  initialDraft?: ActionReportDraft | null;
  incidents?: ActionReportIncident[];
  initialMachineId?: string;
  initialIncidentIds?: string[];
  initialModes?: ActionReportMode[];
}) {
  const action = source === "machine_qr" ? submitQrActionReport : submitWebActionReport;
  const [result, formAction, pending] = useActionState<ActionReportResult | null, FormData>(action, null);
  const [clientUuid] = useState(() => initialDraft?.clientUuid ?? crypto.randomUUID());
  const [revision, setRevision] = useState(initialDraft?.revision ?? 0);
  const [machineId, setMachineId] = useState(initialDraft?.machineId ?? initialMachineId ?? machines[0]?.id ?? "");
  const [modes, setModes] = useState<ActionReportMode[]>(() => initialActionReportModes(initialDraft?.actionModes, initialModes));
  const [occurredAt, setOccurredAt] = useState(initialDraft?.occurredAt ?? initialEventTime);
  const [notes, setNotes] = useState(initialDraft?.notes ?? "");
  const [voicePending, setVoicePending] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>(() => initialDraft?.lines.length ? initialDraft.lines.map((line) => ({ key: crypto.randomUUID(), lotId: line.odooLotId ? String(line.odooLotId) : "", lotCode: line.lotCode, productName: line.productName, quantity: line.quantity, unit: line.unit })) : [newLine()]);
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [selectedIncidentIds, setSelectedIncidentIds] = useState(() => initialDraft?.incidentIds ?? initialIncidentIds);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [stockMessage, setStockMessage] = useState<string | null>(null);
  const submittedLineNumbers = useRef(new Map<string, number>());
  const machine = machines.find((item) => item.id === machineId);
  const availableLots = lots.filter((lot) => machine?.warehouseId === lot.warehouseId);
  const availableIncidents = incidents.filter((incident) => incident.machineId === machineId);
  const unavailableSelectedIncidentIds = selectedIncidentIds.filter((id) => !availableIncidents.some((incident) => incident.id === id));
  const hasCleaning = modes.includes("cleaning");
  const hasRefill = modes.includes("refill");
  const hasOther = modes.includes("other");
  const toggleMode = (mode: ActionReportMode) => {
    setModes((current) => current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode]);
    if (mode === "refill" && !hasRefill && lines.length === 0) setLines([newLine()]);
    if (mode === "refill" && hasRefill) setPhotos((current) => current.filter((photo) => photo.lineKey === null));
  };
  const draftReportId = result?.status === "draft" ? result.reportId : initialDraft?.id;

  function validPhoto(file: File) {
    if (!PHOTO_TYPES.has(file.type.split(";")[0])) return "Choose JPEG, PNG, WebP, or HEIC images.";
    if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) return `${file.name} must be smaller than 4 MB.`;
    return null;
  }

  async function releasePhotos(items: StagedPhoto[]) {
    for (const photo of items) {
      if (!photo.uploaded) continue;
      const response = await fetch(`/api/action-reports/${result?.reportId}/photo-upload`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_id: photo.uploaded.uploadId }) });
      if (!response.ok) { setPhotoMessage("Unable to release a previous photo upload. Retry before replacing it."); return false; }
    }
    const ids = new Set(items.map((photo) => photo.id));
    setPhotos((current) => current.filter((photo) => !ids.has(photo.id)));
    return true;
  }

  async function stageLinePhoto(lineKey: string, file: File | undefined) {
    setPhotoMessage(null);
    const previous = photos.filter((photo) => photo.lineKey === lineKey);
    if (!await releasePhotos(previous)) return;
    if (!file) return;
    const error = validPhoto(file);
    if (error) { setPhotoMessage(error); return; }
    if (photos.filter((photo) => photo.lineKey !== lineKey).length >= 20) { setPhotoMessage("A report can contain at most 20 photos."); return; }
    setPhotos((current) => [...current, { id: crypto.randomUUID(), file, lineKey }]);
  }

  async function stageGeneralPhotos(files: File[]) {
    setPhotoMessage(null);
    const error = files.map(validPhoto).find(Boolean);
    if (error) { setPhotoMessage(error); return; }
    if (files.length + photos.filter((photo) => photo.lineKey !== null).length > 20) { setPhotoMessage("A report can contain at most 20 photos."); return; }
    const previous = photos.filter((photo) => photo.lineKey === null);
    if (!await releasePhotos(previous)) return;
    setPhotos((current) => [...current, ...files.map((file) => ({ id: crypto.randomUUID(), file, lineKey: null }))]);
  }

  async function attachPhotos(reportId: string) {
    if (photoUploading || photos.length === 0) return;
    setPhotoUploading(true);
    setPhotoMessage(`Uploading 0 of ${photos.length} private photos...`);
    const queue = photos.map((photo) => ({ ...photo, lineNumber: photo.lineKey === null ? null : submittedLineNumbers.current.get(photo.lineKey) ?? null }));
    let completed = 0;
    let failed = 0;
    for (const photo of queue) {
      try {
        if (photo.lineKey !== null && (photo.lineNumber === null || photo.lineNumber < 1)) throw new Error("A refill line photo no longer matches its line.");
        let uploaded = photo.uploaded;
        if (!uploaded) {
          const signedResponse = await fetch(`/api/action-reports/${reportId}/photo-upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mime_type: photo.file.type, size_bytes: photo.file.size, line_number: photo.lineNumber }) });
          const signed = await signedResponse.json() as { upload_id?: string; path?: string; token?: string; mime_type?: string; error?: string };
          if (!signedResponse.ok || !signed.upload_id || !signed.path || !signed.token || !signed.mime_type) throw new Error(signed.error ?? "Unable to authorize photo upload.");
          uploaded = { uploadId: signed.upload_id, path: signed.path, token: signed.token, mimeType: signed.mime_type, stored: false };
          setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, uploaded } : item));
        }
        if (!uploaded.stored) {
          const { error } = await createClient().storage.from("service-action-evidence").uploadToSignedUrl(uploaded.path, uploaded.token, photo.file, { contentType: uploaded.mimeType });
          if (error) {
            await fetch(`/api/action-reports/${reportId}/photo-upload`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_id: uploaded.uploadId }) });
            setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, uploaded: undefined } : item));
            throw error;
          }
          uploaded = { ...uploaded, stored: true };
          setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, uploaded } : item));
        }
        const completeResponse = await fetch(`/api/action-reports/${reportId}/photo-upload/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_id: uploaded.uploadId, path: uploaded.path, mime_type: uploaded.mimeType }) });
        const complete = await completeResponse.json() as { error?: string };
        if (!completeResponse.ok) {
          if (completeResponse.status === 400) setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, uploaded: undefined } : item));
          throw new Error(complete.error ?? "Unable to attach photo.");
        }
        completed += 1;
        setPhotos((current) => current.filter((item) => item.id !== photo.id));
      } catch (error) {
        console.error("[action-report-photo]", error);
        failed += 1;
      }
      setPhotoMessage(`Uploading ${completed + failed} of ${queue.length} private photos...`);
    }
    setPhotoUploading(false);
    setPhotoMessage(failed ? `Action confirmed. ${completed} photos attached; ${failed} still need retry.` : `${completed} private photos attached.`);
  }

  const attachAfterConfirmation = useEffectEvent(() => {
    if (result?.status === "confirmed" && result.reportId && photos.length && !photoUploading) void attachPhotos(result.reportId);
  });
  useEffect(() => {
    if (result?.status === "confirmed") queueMicrotask(() => attachAfterConfirmation());
  }, [result?.status, result?.reportId]);

  async function retryStockSnapshot() {
    if (!result?.reportId) return;
    setStockMessage("Capturing live Huaxin menu stock...");
    const response = await fetch(`/api/action-reports/${result.reportId}/stock-snapshot`, { method: "POST" });
    const body = await response.json() as { status?: string; error?: string };
    setStockMessage(response.ok ? `Menu stock observation captured${body.status === "needs_review" ? "; some product mappings need review." : "."}` : body.error ?? "Unable to capture menu stock.");
  }

  return (
    <form id="action-report-form" action={formAction} onSubmit={() => { submittedLineNumbers.current = new Map(lines.map((line, index) => [line.key, index + 1])); setRevision(result?.revision ?? revision); }} className="space-y-5">
      <input type="hidden" name="client_uuid" value={clientUuid} />
      <input type="hidden" name="expected_revision" value={result?.revision ?? revision} />
      <input type="hidden" name="occurred_at" value={occurredAt} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Machine</span>
          {machines.length === 1 ? (
            <><input type="hidden" name="machine_id" value={machineId} /><div className={`${input} bg-cream`}>{machines[0].name}</div></>
          ) : (
            <select
              name="machine_id"
              value={machineId}
              disabled={pending || result?.status === "confirmed"}
              onChange={(event) => { setMachineId(event.target.value); setLines([newLine()]); setPhotos([]); setSelectedIncidentIds([]); }}
              className={`w-full ${input}`}
              required
            >
              <option value="">Select a machine</option>
              {machines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
        </label>
        <label className="block">
          <span className={label}>Action time</span>
          <input
            type="datetime-local"
            value={localDateTime(occurredAt)}
            onChange={(event) => { if (event.target.value) setOccurredAt(new Date(event.target.value).toISOString()); }}
            className={`w-full ${input}`}
            required
          />
        </label>
      </div>

      <fieldset>
        <legend className={label}>Action performed</legend>
        <div className="grid grid-cols-3 gap-2">
          {ACTION_REPORT_MODES.map((mode) => (
            <label key={mode} className={`cursor-pointer rounded-xl border px-3 py-2 text-center text-sm font-bold capitalize ${modes.includes(mode) ? "border-terracotta bg-terracotta text-white" : "border-line bg-white text-cocoa"}`}>
              <input type="checkbox" name="action_modes" value={mode} checked={modes.includes(mode)} onChange={() => toggleMode(mode)} disabled={pending || result?.status === "confirmed"} className="sr-only" />
              {mode}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-taupe">Select Cleaning, Refill, Other, or any combination. The relevant fields will appear below.</p>
      </fieldset>

      {availableIncidents.length > 0 && (
        <fieldset className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <legend className="px-1 font-display font-bold text-cocoa">Incidents addressed</legend>
          <p className="mb-3 text-xs text-taupe">Select every incident this work resolves. A single confirmed report can close several incidents.</p>
          <div className="space-y-2">
            {availableIncidents.map((incident) => <label key={incident.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-white p-3"><input type="checkbox" name="incident_ids" value={incident.id} checked={selectedIncidentIds.includes(incident.id)} disabled={pending || result?.status === "confirmed"} onChange={(event) => setSelectedIncidentIds((current) => event.target.checked ? [...new Set([...current, incident.id])] : current.filter((id) => id !== incident.id))} className="mt-1 accent-terracotta" /><span><span className="block text-sm font-bold text-cocoa">{incident.title}</span><span className="text-xs capitalize text-taupe">{incident.severity} · {incident.typeLabel}</span></span></label>)}
          </div>
        </fieldset>
      )}
      {unavailableSelectedIncidentIds.map((id) => <input key={id} type="hidden" name="incident_ids" value={id} />)}
      {unavailableSelectedIncidentIds.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning"><span>A previously selected incident is no longer available.</span><button type="button" onClick={() => setSelectedIncidentIds((current) => current.filter((id) => !unavailableSelectedIncidentIds.includes(id)))} className="font-bold text-terracotta underline">Remove unavailable selection</button></div>}

      {hasCleaning && (
        <section className="rounded-xl border border-line bg-cream/40 p-4">
          <h3 className="mb-3 font-display font-bold text-cocoa">Cleaning details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className={label}>Cleaning material used</span><select name="cleaning_material_used" className={`w-full ${input}`} defaultValue={initialDraft?.cleaningMaterialUsed === null || initialDraft?.cleaningMaterialUsed === undefined ? "" : initialDraft.cleaningMaterialUsed ? "yes" : "no"} required><option value="" disabled>Select</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="block"><span className={label}>Water buckets</span><input name="water_bucket_count" type="number" min="0" max="20" step="1" defaultValue={initialDraft?.waterBucketCount ?? ""} className={`w-full ${input}`} required /></label>
          </div>
        </section>
      )}

      {hasRefill && (
        <section className="space-y-3">
          <div>
            <h3 className="font-display font-bold text-cocoa">Refill details</h3>
            <p className="text-xs text-taupe">Record what physically entered the machine. Missing warehouse or stock records will be saved as provenance gaps, not rejected.</p>
          </div>
          {lines.map((line, index) => {
            const linePhoto = photos.find((photo) => photo.lineKey === line.key);
            return (
              <div key={line.key} className="rounded-xl border border-line bg-cream/40 p-4">
                <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold uppercase text-taupe">Refill line {index + 1}</span>{lines.length > 1 && <button type="button" disabled={pending || result?.status === "confirmed"} onClick={() => { setLines((current) => current.filter((item) => item.key !== line.key)); setPhotos((current) => current.filter((photo) => photo.lineKey !== line.key)); }} className="text-xs font-bold text-danger disabled:opacity-50">Remove</button>}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><label className="block"><span className={label}>Batch code photo</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={(event) => stageLinePhoto(line.key, event.target.files?.[0])} className={`w-full ${input} text-xs`} /><span className="mt-1 block text-xs text-taupe">Take or choose the photo first, then read the lot details from the preview below.</span></label>{linePhoto && <PhotoPreview key={linePhoto.id} file={linePhoto.file} />}</div>
                  <label className="block sm:col-span-2"><span className={label}>Inventory lot, if known</span><select name="odoo_lot_id" value={line.lotId} onChange={(event) => { const selected = availableLots.find((lot) => String(lot.odooId) === event.target.value); setLines((current) => current.map((item) => item.key === line.key ? { ...item, lotId: event.target.value, lotCode: selected?.name ?? item.lotCode, productName: selected?.productName ?? item.productName } : item)); }} className={`w-full ${input}`}><option value="">Unknown / not listed</option>{availableLots.map((lot) => <option key={lot.odooId} value={lot.odooId}>{lot.name} - {lot.productName} (available {lot.available})</option>)}</select></label>
                  <label className="block"><span className={label}>Observed lot code</span><input name="lot_code" value={line.lotCode} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, lotCode: event.target.value } : item))} placeholder="Type the code on the package" className={`w-full ${input}`} /></label>
                  <label className="block"><span className={label}>Product, if lot unknown</span><input name="product_name" value={line.productName} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, productName: event.target.value } : item))} placeholder="Product name" className={`w-full ${input}`} /></label>
                  <label className="block"><span className={label}>Quantity</span><input name="quantity" type="number" min="0.01" step="0.01" value={line.quantity ?? ""} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value ? Number(event.target.value) : null } : item))} className={`w-full ${input}`} required /></label>
                  <label className="block"><span className={label}>Unit</span><select name="unit" className={`w-full ${input}`} value={line.unit} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, unit: event.target.value } : item))}><option value="unit">Units</option><option value="kg">kg</option><option value="l">litres</option><option value="bag">bags</option><option value="box">boxes</option></select></label>
                </div>
              </div>
            );
          })}
          <button type="button" onClick={() => setLines((current) => [...current, newLine()])} disabled={pending || result?.status === "confirmed" || lines.length >= 20} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-cocoa disabled:opacity-50">+ Add refill line</button>
          {!machine?.warehouseId && machineId && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">No warehouse assignment is recorded for this machine. Confirming will preserve the refill as an unresolved provenance gap.</p>}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="block"><label htmlFor="action-report-notes" className={label}>Notes</label><textarea id="action-report-notes" name="notes" rows={4} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} required={hasOther} placeholder={hasOther ? "Describe the other action" : "Optional context"} className={`w-full ${input}`} /><ActionReportVoice reportId={draftReportId ?? null} notesLength={notes.length} onPendingChange={setVoicePending} onTranscript={(transcript) => setNotes((current) => [current.trim(), transcript.trim()].filter(Boolean).join("\n\n"))} /></div>
        <label className="block"><span className={label}>General evidence photos</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={(event) => stageGeneralPhotos(Array.from(event.target.files ?? []))} className={`w-full ${input} text-xs`} /><span className="mt-1 block text-xs text-taupe">Choose up to 20 private images, maximum 4 MB each. They upload directly after confirmation.</span></label>
      </div>

      {hasRefill && <p className="rounded-lg bg-sage/10 px-3 py-2 text-xs font-semibold text-sage">Confirming a refill captures Huaxin stock when the report is entered. For a backdated refill, completed sales since the action time are added back to reconstruct the stock shown at the refill time.</p>}
      {photos.length > 0 && <p className="text-xs font-semibold text-taupe">{photos.length} photo{photos.length === 1 ? "" : "s"} staged in this browser tab. Save a draft to keep the report; photos attach only after confirmation.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="intent" value="confirmed" disabled={pending || voicePending || !machineId || modes.length === 0 || result?.status === "confirmed"} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">{pending ? "Saving..." : voicePending ? "Attach or discard voice first" : "Confirm action"}</button>
        <button type="submit" name="intent" value="draft" formNoValidate disabled={pending || !machineId || modes.length === 0 || result?.status === "confirmed"} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-cocoa disabled:opacity-60">Save draft</button>
        {result?.ok && <span className={`text-sm font-semibold ${result.warning ? "text-warning" : "text-sage"}`}>{result.status === "draft" ? "Draft saved." : result.provenanceStatus === "resolved" ? "Action confirmed." : "Action confirmed with a provenance gap."} {result.warning}</span>}
        {result && !result.ok && <span className="text-sm font-semibold text-danger">{result.error}</span>}
        {photoMessage && <span className={`text-sm font-semibold ${photos.length ? "text-warning" : "text-sage"}`}>{photoMessage}</span>}
        {result?.status === "confirmed" && photos.length > 0 && !photoUploading && <button type="button" onClick={() => { if (result.reportId) void attachPhotos(result.reportId); }} className="rounded-lg border border-warning/40 bg-white px-3 py-2 text-sm font-bold text-warning">Retry {photos.length} photo{photos.length === 1 ? "" : "s"}</button>}
        {result?.status === "confirmed" && result.stockSnapshotStatus === "failed" && <button type="button" onClick={() => { void retryStockSnapshot(); }} className="rounded-lg border border-warning/40 bg-white px-3 py-2 text-sm font-bold text-warning">Retry menu stock capture</button>}
        {stockMessage && <span className="text-sm font-semibold text-taupe">{stockMessage}</span>}
        {result?.status === "confirmed" && <a href="/refills#action-report-form" className="text-sm font-bold text-terracotta hover:underline">Start another report</a>}
      </div>
    </form>
  );
}
