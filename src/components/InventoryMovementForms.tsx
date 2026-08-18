"use client";

import { useActionState, useState } from "react";
import { recordCorrection, recordReceipt, recordStockTransfer, type InventoryActionResult } from "@/app/actions/inventory-reconciliation";
import type { InventoryLotOption, WarehouseOption } from "@/lib/data/inventory-reconciliation";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-taupe";

function MovementForm({ kind, warehouses, lots }: { kind: "receipt" | "transfer" | "correction"; warehouses: WarehouseOption[]; lots: InventoryLotOption[] }) {
  const action = kind === "receipt" ? recordReceipt : kind === "transfer" ? recordStockTransfer : recordCorrection;
  const [result, formAction, pending] = useActionState<InventoryActionResult | null, FormData>(action, null);
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [occurredAt] = useState(() => new Date().toISOString());
  const title = kind === "receipt" ? "Warehouse receipt" : kind === "transfer" ? "Warehouse transfer" : "Stock correction";
  return (
    <form action={formAction} className="rounded-xl border border-line bg-cream/30 p-4">
      <input type="hidden" name="client_uuid" value={clientUuid} />
      <input type="hidden" name="occurred_at" value={occurredAt} />
      <h3 className="mb-3 font-display font-bold text-cocoa">{title}</h3>
      <div className="space-y-3">
        <label className="block"><span className={label}>{kind === "transfer" ? "Source warehouse" : "Warehouse"}</span><select name="warehouse_id" className={input} required><option value="">Select</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        {kind === "transfer" && <label className="block"><span className={label}>Destination warehouse</span><select name="destination_warehouse_id" className={input} required><option value="">Select</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>}
        <label className="block"><span className={label}>Odoo lot</span><select name="odoo_lot_id" className={input} required><option value="">Select</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.name} - {lot.productName} ({lot.stockUnit})</option>)}</select></label>
        <label className="block"><span className={label}>{kind === "correction" ? "Signed quantity" : "Quantity"}</span><input name="quantity" type="number" step="0.01" {...(kind === "correction" ? {} : { min: "0.01" })} className={input} required /></label>
        <label className="block"><span className={label}>Reason</span><input name="reason" className={input} required placeholder="Document the physical stock path" /></label>
        <button disabled={pending || result?.ok} className="rounded-lg bg-cocoa px-3 py-2 text-sm font-bold text-white disabled:opacity-60">{pending ? "Recording..." : `Record ${kind}`}</button>
        {result?.ok && <p className="text-xs font-semibold text-sage">{result.message}</p>}
        {result && !result.ok && <p className="text-xs font-semibold text-danger">{result.error}</p>}
        {result?.ok && <a href="/inventory" className="text-xs font-bold text-terracotta hover:underline">Record another movement</a>}
      </div>
    </form>
  );
}

export function InventoryMovementForms({ warehouses, lots }: { warehouses: WarehouseOption[]; lots: InventoryLotOption[] }) {
  return <div className="grid gap-4 lg:grid-cols-3"><MovementForm kind="receipt" warehouses={warehouses} lots={lots} /><MovementForm kind="transfer" warehouses={warehouses} lots={lots} /><MovementForm kind="correction" warehouses={warehouses} lots={lots} /></div>;
}
