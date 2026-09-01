"use client";

import { useActionState, useState } from "react";
import type { MachineConfig } from "@/lib/data/machine-config";
import { saveMachineWarehousePeriod, type SaveResult } from "./actions";

export function WarehouseAssignmentPeriods({ config, imei, today }: { config: MachineConfig; imei: string; today: string }) {
  const [result, action, pending] = useActionState<SaveResult | null, FormData>(saveMachineWarehousePeriod, null);
  const [allHistory, setAllHistory] = useState(false);
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const latestPastDate = yesterday.toISOString().slice(0, 10);
  const assignments = config.warehouseAssignments.reduce<MachineConfig["warehouseAssignments"]>((rows, assignment) => {
    const previous = rows.at(-1);
    if (previous && previous.odooWarehouseId === assignment.odooWarehouseId && previous.validTo === assignment.validFrom) {
      rows[rows.length - 1] = { ...previous, validTo: assignment.validTo };
    } else {
      rows.push({ ...assignment });
    }
    return rows;
  }, []);
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-taupe">Historical warehouse assignment periods</h3>
      <p className="mt-1 text-xs text-taupe">These dates determine the warehouse-at-sale snapshot used by manufacturing exports. Leave through blank for the warehouse effective now; bounded event periods must have ended before today. Applying a period replaces only the selected dates and preserves earlier/later history.</p>
      <form action={action} className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_9rem] sm:items-end">
        <input type="hidden" name="machine_id" value={config.machineId ?? ""} />
        <input type="hidden" name="imei" value={imei} />
        <label className="text-xs text-taupe"><span className="mb-1 block">Warehouse</span><select name="warehouse_id" required className="w-full rounded border border-line bg-white px-2 py-2 text-cocoa"><option value="">Select</option>{config.odooWarehouses.map((warehouse) => <option key={warehouse.odoo_id} value={warehouse.odoo_id}>{warehouse.name}</option>)}</select></label>
        <label className="text-xs text-taupe"><span className="mb-1 block">From date</span><input name="date_from" type="date" max={today} required={!allHistory} disabled={allHistory} className="w-full rounded border border-line px-2 py-2 text-cocoa disabled:bg-cream" /></label>
        <label className="text-xs text-taupe"><span className="mb-1 block">Through date</span><input name="date_to" type="date" max={latestPastDate} disabled={allHistory} className="w-full rounded border border-line px-2 py-2 text-cocoa disabled:bg-cream" /></label>
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-cream/40 p-3 sm:col-span-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-2 text-xs font-semibold text-cocoa"><input type="checkbox" name="all_history" checked={allHistory} onChange={(event) => setAllHistory(event.target.checked)} className="mt-0.5" /><span>All stored history<span className="block font-normal text-taupe">Start with this machine&apos;s first stored sale and continue open ended.</span></span></label>
          <button disabled={pending} className="shrink-0 rounded bg-cocoa px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Applying..." : "Apply assignment period"}</button>
        </div>
      </form>
      {result && <p className={`mt-2 text-xs ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Assignment applied and historical sales recomputed." : result.error}</p>}
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] text-xs"><thead className="text-left uppercase text-taupe"><tr><th className="py-2">Warehouse</th><th>From</th><th>Through</th></tr></thead><tbody className="divide-y divide-line">{assignments.map((assignment) => <tr key={assignment.id}><td className="py-2 font-semibold text-cocoa">{assignment.warehouseName}</td><td>{new Date(assignment.validFrom).toLocaleDateString("en-GB", { timeZone: "Europe/Madrid" })}</td><td>{assignment.validTo ? new Date(new Date(assignment.validTo).getTime() - 1).toLocaleDateString("en-GB", { timeZone: "Europe/Madrid" }) : "Open ended"}</td></tr>)}</tbody></table>{!assignments.length && <p className="py-3 text-xs text-taupe">No assignment periods recorded.</p>}</div>
    </div>
  );
}
