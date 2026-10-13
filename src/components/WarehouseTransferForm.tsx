"use client";

import { useActionState, useState } from "react";
import { recordStockTransfer, type InventoryActionResult } from "@/app/actions/inventory-reconciliation";
import type { InventoryTransferWorkspace } from "@/lib/inventory-transfers";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-taupe";

export function WarehouseTransferForm({ workspace }: { workspace: InventoryTransferWorkspace }) {
  const [result, formAction, pending] = useActionState<InventoryActionResult | null, FormData>(recordStockTransfer, null);
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [occurredAt] = useState(() => new Date().toISOString());
  const [selectedLotId, setSelectedLotId] = useState("");
  const lot = workspace.lots.find((candidate) => String(candidate.id) === selectedLotId);
  const unavailable = !workspace.sourceWarehouse || !workspace.destinationWarehouses.length || !workspace.lots.length;
  return (
    <form action={formAction} className="rounded-2xl border border-line bg-white p-5">
      <input type="hidden" name="client_uuid" value={clientUuid} />
      <input type="hidden" name="occurred_at" value={occurredAt} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-xl font-bold text-cocoa">Move central stock</h2><p className="mt-1 text-sm text-taupe">Creates one audited Odoo internal transfer. Submitting the same request twice is safe.</p></div>
        <span className="rounded-full bg-sand px-3 py-1 text-xs font-bold text-cocoa">From: {workspace.sourceWarehouse?.name ?? "Not configured"}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label><span className={label}>Destination subwarehouse</span><select name="destination_warehouse_id" className={input} required disabled={unavailable}><option value="">Select destination</option>{workspace.destinationWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label><span className={label}>Central lot</span><select name="odoo_lot_id" className={input} required disabled={unavailable} value={selectedLotId} onChange={(event) => setSelectedLotId(event.target.value)}><option value="">Select available lot</option>{workspace.lots.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.productName} · {candidate.name} · {candidate.quantity} {candidate.stockUnit}</option>)}</select></label>
        <label><span className={label}>Quantity{lot ? ` · up to ${lot.quantity} ${lot.stockUnit}` : ""}</span><input name="quantity" type="number" min="0.01" max={lot?.quantity} step="0.01" className={input} required disabled={unavailable} /></label>
        <label><span className={label}>Reason</span><input name="reason" maxLength={1000} className={input} required disabled={unavailable} placeholder="Why and where this stock is moving" /></label>
      </div>
      {!workspace.sourceWarehouse && <p className="mt-4 text-sm font-semibold text-danger">Configure the central stock warehouse in Odoo settings before transferring stock.</p>}
      {workspace.sourceWarehouse && !workspace.lots.length && <p className="mt-4 text-sm text-taupe">No positive effective stock is available in the central warehouse.</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button disabled={pending || result?.ok || unavailable} className="rounded-lg bg-cocoa px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{pending ? "Queuing transfer..." : "Queue transfer to Odoo"}</button>
        {result?.ok && <><p className="text-sm font-semibold text-sage">{result.message}</p><a href="/transfers" className="text-sm font-bold text-terracotta hover:underline">Record another</a></>}
        {result && !result.ok && <p className="text-sm font-semibold text-danger">{result.error}</p>}
      </div>
    </form>
  );
}
