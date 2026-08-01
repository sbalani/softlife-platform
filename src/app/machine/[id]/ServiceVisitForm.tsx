"use client";

import { useActionState, useState } from "react";
import type { ServiceLot } from "@/lib/data/machine-service";
import { submitMachineService, type ServiceResult } from "./actions";

type Mode = "refill" | "cleaning" | "both";
type RefillLine = { key: string; lotId: string; quantity: string };

const input = "w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-cocoa focus:border-terracotta focus:outline-none";

export function ServiceVisitForm({ machineId, visitUuid, eventTime, lots, warehouseAssigned }: { machineId: string; visitUuid: string; eventTime: string; lots: ServiceLot[]; warehouseAssigned: boolean }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [stableVisitUuid] = useState(visitUuid);
  const [stableEventTime] = useState(eventTime);
  const [lines, setLines] = useState<RefillLine[]>([{ key: "initial", lotId: "", quantity: "" }]);
  const [materialUsed, setMaterialUsed] = useState("");
  const [bucketCount, setBucketCount] = useState("");
  const [result, action, pending] = useActionState<ServiceResult | null, FormData>(submitMachineService, null);
  const needsRefill = mode === "refill" || mode === "both";
  const needsCleaning = mode === "cleaning" || mode === "both";
  const refillAvailable = warehouseAssigned && lots.length > 0;

  if (result?.ok) {
    return <div className="rounded-2xl border border-sage/30 bg-sage/10 p-6 text-center"><h2 className="font-display text-2xl font-bold text-cocoa">Visit recorded</h2><p className="mt-2 text-sm text-taupe">The event is stored in Supabase and queued for the future Odoo synchronization.</p><button onClick={() => location.reload()} className="mt-5 rounded-xl bg-cocoa px-5 py-3 font-bold text-white">Record another visit</button></div>;
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="machine_id" value={machineId} />
      <input type="hidden" name="visit_uuid" value={stableVisitUuid} />
      <input type="hidden" name="event_time" value={stableEventTime} />
      <input type="hidden" name="mode" value={mode ?? ""} />
      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ["refill", "Refill only", "Record the lot and quantity loaded"],
          ["cleaning", "Cleaning only", "Confirm materials and water used"],
          ["both", "Refill & cleaning", "Complete both records together"],
        ] as const).map(([value, title, description]) => {
          const disabled = value !== "cleaning" && !refillAvailable;
          return <button key={value} type="button" disabled={disabled} onClick={() => setMode(value)} className={`rounded-2xl border p-4 text-left transition ${mode === value ? "border-terracotta bg-terracotta/10" : "border-line bg-white"} disabled:cursor-not-allowed disabled:opacity-40`}><span className="block font-display text-lg font-bold text-cocoa">{title}</span><span className="mt-1 block text-xs text-taupe">{description}</span></button>;
        })}
      </div>

      {!warehouseAssigned && <p className="rounded-xl bg-rose/10 p-3 text-sm text-rose">Refills are unavailable until an admin assigns this machine’s service warehouse.</p>}
      {warehouseAssigned && !lots.length && <p className="rounded-xl bg-rose/10 p-3 text-sm text-rose">This warehouse has no available Odoo lots. Cleaning can still be recorded.</p>}

      {needsRefill && <section className="rounded-2xl border border-line bg-white p-5"><h2 className="font-display text-xl font-bold text-cocoa">Refill</h2><div className="mt-4 space-y-3">{lines.map((line, index) => <div key={line.key} className="grid gap-3 rounded-xl bg-cream/60 p-3 sm:grid-cols-[1fr_140px_auto]"><label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Lot {index + 1}</span><select required name="odoo_lot_id" className={input} value={line.lotId} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, lotId: event.target.value } : item))}><option value="" disabled>Select a lot</option>{lots.map((lot) => <option key={lot.odoo_id} value={lot.odoo_id}>{lot.name} · {lot.product_name} · {lot.available} available</option>)}</select></label><label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Quantity</span><input required name="quantity_used" type="number" min="0.01" step="0.01" className={input} value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></label>{lines.length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="self-end px-2 py-3 text-sm font-bold text-danger">Remove</button>}</div>)}</div><button type="button" disabled={lines.length >= 20} onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), lotId: "", quantity: "" }])} className="mt-3 rounded-lg border border-line px-3 py-2 text-sm font-bold text-cocoa disabled:opacity-40">Add another lot</button></section>}

      {needsCleaning && <section className="rounded-2xl border border-line bg-white p-5"><h2 className="font-display text-xl font-bold text-cocoa">Full cleaning confirmation</h2><fieldset className="mt-4"><legend className="text-sm font-bold text-cocoa">Did you use cleaning material?</legend><div className="mt-2 flex gap-5"><label className="flex items-center gap-2"><input required type="radio" name="cleaning_material_used" value="yes" checked={materialUsed === "yes"} onChange={(event) => setMaterialUsed(event.target.value)} /> Yes</label><label className="flex items-center gap-2"><input required type="radio" name="cleaning_material_used" value="no" checked={materialUsed === "no"} onChange={(event) => setMaterialUsed(event.target.value)} /> No</label></div></fieldset><label className="mt-4 block max-w-xs"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Buckets of water used</span><input required name="water_bucket_count" type="number" min="0" max="20" step="1" className={input} value={bucketCount} onChange={(event) => setBucketCount(event.target.value)} /></label></section>}

      {mode && <button type="submit" disabled={pending} className="w-full rounded-xl bg-terracotta px-5 py-4 text-base font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">{pending ? "Recording…" : "Confirm and record"}</button>}
      {result && !result.ok && <p className="rounded-xl bg-danger/10 p-3 text-sm font-semibold text-danger">{result.error}</p>}
    </form>
  );
}
