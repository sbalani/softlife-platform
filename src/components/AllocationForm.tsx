"use client";

import { useActionState, useState } from "react";
import { confirmAllocation, type InventoryActionResult } from "@/app/actions/inventory-reconciliation";

type Candidate = { lotId: number; lotCode: string; productName: string; stockUnit: string; available: number; match: string };

export function AllocationForm({ lineId, warehouseId, physicalUnit, outstanding, candidates }: { lineId: string; warehouseId: number; physicalUnit: string; outstanding: number; candidates: Candidate[] }) {
  const [result, action, pending] = useActionState<InventoryActionResult | null, FormData>(confirmAllocation, null);
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [lotId, setLotId] = useState(String(candidates[0]?.lotId ?? ""));
  const selected = candidates.find((candidate) => String(candidate.lotId) === lotId);
  const unitsMatch = selected?.stockUnit.toLocaleLowerCase() === physicalUnit.toLocaleLowerCase();
  const suggestedQuantity = Math.min(outstanding, selected?.available ?? outstanding);
  const input = "rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
  if (!candidates.length) return <p className="text-xs text-warning">No exact in-stock candidate. Record the missing receipt/transfer or correct the observed lot first.</p>;
  return <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
    <input type="hidden" name="client_uuid" value={clientUuid} /><input type="hidden" name="refill_line_id" value={lineId} /><input type="hidden" name="warehouse_id" value={warehouseId} />
    <label><span className="block text-[10px] font-bold uppercase text-taupe">Candidate</span><select name="odoo_lot_id" value={lotId} onChange={(event) => setLotId(event.target.value)} className={input}>{candidates.map((candidate) => <option key={candidate.lotId} value={candidate.lotId}>{candidate.lotCode} ({candidate.available} {candidate.stockUnit}, {candidate.match})</option>)}</select></label>
    <label><span className="block text-[10px] font-bold uppercase text-taupe">Physical qty</span><input name="physical_quantity" type="number" min="0.01" max={outstanding} step="0.01" defaultValue={unitsMatch ? suggestedQuantity : outstanding} className={`w-24 ${input}`} required /></label>
    <label><span className="block text-[10px] font-bold uppercase text-taupe">Stock qty ({selected?.stockUnit})</span><input name="stock_quantity" type="number" min="0.01" max={selected?.available} step="0.01" defaultValue={unitsMatch ? suggestedQuantity : undefined} className={`w-24 ${input}`} required /></label>
    {!unitsMatch && <label><span className="block text-[10px] font-bold uppercase text-taupe">Conversion explanation</span><input name="conversion_note" placeholder={`${physicalUnit} to ${selected?.stockUnit}`} className={`w-44 ${input}`} required /></label>}
    <button disabled={pending || result?.ok} className="rounded-lg bg-terracotta px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "Confirming..." : "Confirm allocation"}</button>
    {result?.ok && <span className="text-xs font-semibold text-sage">{result.message}</span>}{result && !result.ok && <span className="text-xs font-semibold text-danger">{result.error}</span>}
  </form>;
}
