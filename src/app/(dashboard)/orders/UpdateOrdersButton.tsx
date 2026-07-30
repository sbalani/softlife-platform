"use client";

import { useActionState, useState } from "react";
import { updateOrders, type UpdateOrdersResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";

type MachineOption = { id: string; name: string; imei: string };

export function UpdateOrdersButton({ machines }: { machines: MachineOption[] }) {
  const [res, action, pending] = useActionState<UpdateOrdersResult | null, FormData>(updateOrders, null);
  const [selectedImeis, setSelectedImeis] = useState<string[]>([]);

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {res && (
          <span className={`text-xs font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>{res.summary}</span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Updating…" : "↻ Update orders"}
        </button>
      </div>
      <details className="text-right">
        <summary className="cursor-pointer text-[11px] font-semibold text-taupe hover:text-terracotta">
          Advanced: custom date range
        </summary>
        <div className="mt-2 flex flex-wrap items-end justify-end gap-2">
          <label className="block text-left">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">From</span>
            <input name="from" type="date" className={input} />
          </label>
          <label className="block text-left">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">To</span>
            <input name="to" type="date" className={input} />
          </label>
        </div>
        <input type="hidden" name="deviceImeis" value={selectedImeis.join(",")} />
        <div className="mt-3 rounded-xl border border-line bg-white p-3 text-left">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-taupe">Machines ({selectedImeis.length || "all"})</span>
            <button type="button" onClick={() => setSelectedImeis(selectedImeis.length === machines.length ? [] : machines.map((machine) => machine.imei))} className="text-xs font-semibold text-terracotta">{selectedImeis.length === machines.length ? "Clear" : "Select all"}</button>
          </div>
          <div className="grid max-h-48 min-w-72 gap-1 overflow-y-auto sm:grid-cols-2">
            {machines.map((machine) => <label key={machine.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-cocoa hover:bg-cream"><input type="checkbox" checked={selectedImeis.includes(machine.imei)} onChange={(event) => setSelectedImeis((current) => event.target.checked ? [...current, machine.imei] : current.filter((imei) => imei !== machine.imei))} className="accent-terracotta" /><span><span className="font-semibold">{machine.name}</span> <span className="font-mono text-[10px] text-taupe">{machine.imei}</span></span></label>)}
          </div>
        </div>
        <p className="mt-1 text-[10px] text-taupe">
          Default is the last 7 days and all machines. Select machines to limit the fetch (max 92 days per run).
        </p>
      </details>
    </form>
  );
}
