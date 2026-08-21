"use client";

import { useActionState, useState } from "react";
import {
  submitQrActionReport,
  submitWebActionReport,
  type ActionReportResult,
} from "@/app/actions/service-action-reports";
import type { ActionReportDraft } from "@/lib/data/action-reports";
import { ActionReportVoice } from "@/components/ActionReportVoice";
import { ACTION_REPORT_MODES, modesFromLegacyKind, type ActionReportMode } from "@/lib/action-report-modes";

export type ActionReportMachine = { id: string; name: string; warehouseId: number | null };
export type ActionReportLot = {
  odooId: number;
  name: string;
  productName: string;
  available: number;
  warehouseId: number;
};

type LineDraft = { key: string; lotId: string; lotCode: string; productName: string; quantity: number | null; unit: string };
const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-taupe";

function localDateTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function newLine(lotId = ""): LineDraft {
  return { key: crypto.randomUUID(), lotId, lotCode: "", productName: "", quantity: null, unit: "unit" };
}

export function ActionReportForm({
  machines,
  lots,
  source = "web",
  initialEventTime,
  initialDraft,
}: {
  machines: ActionReportMachine[];
  lots: ActionReportLot[];
  source?: "web" | "machine_qr";
  initialEventTime: string;
  initialDraft?: ActionReportDraft | null;
}) {
  const action = source === "machine_qr" ? submitQrActionReport : submitWebActionReport;
  const [result, formAction, pending] = useActionState<ActionReportResult | null, FormData>(action, null);
  const [clientUuid] = useState(() => initialDraft?.clientUuid ?? crypto.randomUUID());
  const [machineId, setMachineId] = useState(initialDraft?.machineId ?? machines[0]?.id ?? "");
  const [modes, setModes] = useState<ActionReportMode[]>(initialDraft?.actionModes ?? modesFromLegacyKind(initialDraft?.actionKind ?? "both"));
  const [occurredAt, setOccurredAt] = useState(initialDraft?.occurredAt ?? initialEventTime);
  const [lines, setLines] = useState<LineDraft[]>(() => initialDraft?.lines.length ? initialDraft.lines.map((line) => ({ key: crypto.randomUUID(), lotId: line.odooLotId ? String(line.odooLotId) : "", lotCode: line.lotCode, productName: line.productName, quantity: line.quantity, unit: line.unit })) : [newLine()]);
  const machine = machines.find((item) => item.id === machineId);
  const availableLots = lots.filter((lot) => machine?.warehouseId === lot.warehouseId);
  const hasCleaning = modes.includes("cleaning");
  const hasRefill = modes.includes("refill");
  const hasOther = modes.includes("other");
  const toggleMode = (mode: ActionReportMode) => {
    setModes((current) => current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode]);
    if (mode === "refill" && !hasRefill && lines.length === 0) setLines([newLine()]);
  };
  const draftReportId = result?.status === "draft" ? result.reportId : initialDraft?.id;

  return (
    <form id="action-report-form" action={formAction} className="space-y-5">
      <input type="hidden" name="client_uuid" value={clientUuid} />
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
              onChange={(event) => { setMachineId(event.target.value); setLines([newLine()]); }}
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
              <input type="checkbox" name="action_modes" value={mode} checked={modes.includes(mode)} onChange={() => toggleMode(mode)} className="sr-only" />
              {mode}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-taupe">Select every action performed during this activity.</p>
      </fieldset>

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
            return (
              <div key={line.key} className="rounded-xl border border-line bg-cream/40 p-4">
                <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold uppercase text-taupe">Refill line {index + 1}</span>{lines.length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="text-xs font-bold text-danger">Remove</button>}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2"><span className={label}>Inventory lot, if known</span><select name="odoo_lot_id" value={line.lotId} onChange={(event) => { const selected = availableLots.find((lot) => String(lot.odooId) === event.target.value); setLines((current) => current.map((item) => item.key === line.key ? { ...item, lotId: event.target.value, lotCode: selected?.name ?? item.lotCode, productName: selected?.productName ?? item.productName } : item)); }} className={`w-full ${input}`}><option value="">Unknown / not listed</option>{availableLots.map((lot) => <option key={lot.odooId} value={lot.odooId}>{lot.name} - {lot.productName} (available {lot.available})</option>)}</select></label>
                  <label className="block"><span className={label}>Observed lot code</span><input name="lot_code" value={line.lotCode} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, lotCode: event.target.value } : item))} placeholder="Type the code on the package" className={`w-full ${input}`} /></label>
                  <label className="block"><span className={label}>Product, if lot unknown</span><input name="product_name" value={line.productName} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, productName: event.target.value } : item))} placeholder="Product name" className={`w-full ${input}`} /></label>
                  <label className="block"><span className={label}>Quantity</span><input name="quantity" type="number" min="0.01" step="0.01" value={line.quantity ?? ""} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value ? Number(event.target.value) : null } : item))} className={`w-full ${input}`} required /></label>
                  <label className="block"><span className={label}>Unit</span><select name="unit" className={`w-full ${input}`} value={line.unit} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, unit: event.target.value } : item))}><option value="unit">Units</option><option value="kg">kg</option><option value="l">litres</option><option value="bag">bags</option><option value="box">boxes</option></select></label>
                  <label className="block sm:col-span-2"><span className={label}>Batch code photo</span><input name="line_photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" className={`w-full ${input} text-xs`} /></label>
                </div>
              </div>
            );
          })}
          <button type="button" onClick={() => setLines((current) => [...current, newLine()])} disabled={lines.length >= 20} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-cocoa disabled:opacity-50">+ Add refill line</button>
          {!machine?.warehouseId && machineId && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">No warehouse assignment is recorded for this machine. Confirming will preserve the refill as an unresolved provenance gap.</p>}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>Notes</span><textarea name="notes" rows={4} defaultValue={initialDraft?.notes ?? ""} required={hasOther} placeholder={hasOther ? "Describe the other action" : "Optional context"} className={`w-full ${input}`} /></label>
        <label className="block"><span className={label}>General evidence photos</span><input name="evidence_photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" multiple className={`w-full ${input} text-xs`} /><span className="mt-1 block text-xs text-taupe">Private evidence. Maximum 4 MB per image and 5 MB per submission.</span></label>
      </div>

      {draftReportId ? <ActionReportVoice reportId={draftReportId} /> : <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-taupe">Save this report as a draft to record a private voice note and generate reviewable suggestions.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="intent" value="confirmed" disabled={pending || !machineId || modes.length === 0 || result?.status === "confirmed"} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">{pending ? "Saving..." : "Confirm action"}</button>
        <button type="submit" name="intent" value="draft" formNoValidate disabled={pending || !machineId || modes.length === 0 || result?.status === "confirmed"} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-cocoa disabled:opacity-60">Save draft</button>
        {result?.ok && <span className={`text-sm font-semibold ${result.warning ? "text-warning" : "text-sage"}`}>{result.status === "draft" ? "Draft saved." : result.provenanceStatus === "resolved" ? "Action confirmed." : "Action confirmed with a provenance gap."} {result.warning}</span>}
        {result && !result.ok && <span className="text-sm font-semibold text-danger">{result.error}</span>}
        {result?.status === "confirmed" && <a href="/refills#action-report-form" className="text-sm font-bold text-terracotta hover:underline">Start another report</a>}
      </div>
    </form>
  );
}
