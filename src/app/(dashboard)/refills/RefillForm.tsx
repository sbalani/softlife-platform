"use client";

import { useState } from "react";
import { useActionState } from "react";
import { submitRefill, type RefillResult } from "./actions";

type MachineOption = { id: string; name: string };
type LotOption = { id: string; name: string; product_name: string | null; qty_available: number };

type LineDraft = { key: string; lotId: string };

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

function newLine(defaultLotId: string): LineDraft {
  return { key: crypto.randomUUID(), lotId: defaultLotId };
}

export function RefillForm({ machines, lots }: { machines: MachineOption[]; lots: LotOption[] }) {
  const [res, action, pending] = useActionState<RefillResult | null, FormData>(submitRefill, null);
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [lines, setLines] = useState<LineDraft[]>(lots.length ? [newLine(lots[0].id)] : []);

  const lotById = new Map(lots.map((l) => [l.id, l]));

  return (
    <form action={action} className="space-y-4">
      <div>
        <span className={label}>Machine</span>
        <div className="flex flex-wrap gap-2">
          {machines.map((m) => (
            <label
              key={m.id}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold ${
                m.id === machineId ? "border-terracotta bg-terracotta text-white" : "border-line bg-white text-cocoa"
              }`}
            >
              <input type="radio" name="machine_id" value={m.id} checked={m.id === machineId} onChange={() => setMachineId(m.id)} className="hidden" />
              {m.name}
            </label>
          ))}
        </div>
        {machines.length === 0 && <p className="text-sm text-taupe">No machines available.</p>}
      </div>

      <div className="space-y-3">
        <span className={label}>Lots used (multi-lot, FIFO suggested)</span>
        {lines.map((line, idx) => {
          const isFifoSuggestion = idx === 0 && lots.length > 0 && lots[0].id === line.lotId;
          const lot = lotById.get(line.lotId);
          return (
            <div key={line.key} className="rounded-xl border border-line bg-cream/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-taupe">
                  Line {idx + 1}
                  {isFifoSuggestion && <span className="ml-2 rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-bold text-sage">FIFO suggested</span>}
                </span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    className="text-xs font-semibold text-danger hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block sm:col-span-2">
                  <span className={label}>Lot</span>
                  <select
                    name="lot_id"
                    value={line.lotId}
                    onChange={(e) =>
                      setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, lotId: e.target.value } : l)))
                    }
                    className={`w-full ${input}`}
                  >
                    <option value="">Select a lot…</option>
                    {lots.map((l, i) => (
                      <option key={l.id} value={l.id}>
                        {i === 0 ? "★ " : ""}
                        {l.name} — {l.product_name ?? "—"} (avail {l.qty_available})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={label}>Quantity used</span>
                  <input name="qty" type="number" step="0.1" min="0" placeholder="0" className={`w-full ${input}`} />
                </label>
              </div>
              <label className="mt-3 block">
                <span className={label}>Batch code photo</span>
                <input name="photo" type="file" accept="image/*" capture="environment" className={`w-full text-xs ${input}`} />
              </label>
              {lot && lot.qty_available <= 0 && (
                <p className="mt-1 text-xs text-warning">This lot shows 0 available — double-check before using it.</p>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, newLine(lots[0]?.id ?? "")])}
          disabled={!lots.length}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-cocoa hover:bg-cream disabled:opacity-50"
        >
          + Add another lot
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending || !machineId || !lines.length}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save refill"}
        </button>
        {res && !res.ok && <span className="text-xs text-danger">{res.error}</span>}
        {res && res.ok && <span className="text-sm font-semibold text-sage">Refill logged.</span>}
      </div>
    </form>
  );
}
