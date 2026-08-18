import { getLots } from "@/lib/data/lots";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getInventoryReconciliation } from "@/lib/data/inventory-reconciliation";
import { InventoryMovementForms } from "@/components/InventoryMovementForms";
import { VoidAllocationForm } from "@/components/VoidAllocationForm";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  released: "bg-sage/15 text-sage",
  hold: "bg-warning/15 text-warning",
  dispose: "bg-danger/15 text-danger",
};

export default async function InventoryPage() {
  const [lots, inventory, tz] = await Promise.all([getLots(), getInventoryReconciliation(), getDisplayTimezone()]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Inventory</h1>
        <p className="mt-1 text-sm text-taupe">Odoo mirror plus documented platform movements, reservations, and synchronization state.</p>
      </header>

      <section className="mb-8 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-1 font-display text-xl font-bold text-cocoa">Record stock movement</h2>
        <p className="mb-4 text-sm text-taupe">Movements are append-only and queued for Odoo. Negative changes cannot make effective stock negative.</p>
        <InventoryMovementForms warehouses={inventory.warehouses} lots={inventory.lots} />
      </section>

      <section className="mb-8 overflow-x-auto rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Effective warehouse stock</h2><p className="text-xs text-taupe">Positive platform receipts remain pending until the Odoo mirror acknowledges them; outbound movements reserve immediately.</p></div>
        <table className="w-full min-w-[760px] text-sm"><thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe"><tr><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3">Lot</th><th className="px-4 py-3">Product</th><th className="px-4 py-3 text-right">Mirror</th><th className="px-4 py-3 text-right">Platform outbound</th><th className="px-4 py-3 text-right">Legacy reserved</th><th className="px-4 py-3 text-right">Effective</th></tr></thead><tbody className="divide-y divide-line">{inventory.balances.map((balance) => <tr key={`${balance.warehouseId}:${balance.lotId}`}><td className="px-4 py-3 font-semibold text-cocoa">{balance.warehouseName}</td><td className="px-4 py-3 font-mono text-xs text-cocoa">{balance.lotName}</td><td className="px-4 py-3 text-taupe">{balance.productName}</td><td className="px-4 py-3 text-right">{balance.mirrorQuantity}</td><td className="px-4 py-3 text-right">{balance.platformOverlay}</td><td className="px-4 py-3 text-right">{balance.legacyReserved}</td><td className="px-4 py-3 text-right font-bold text-cocoa">{balance.effectiveQuantity}</td></tr>)}{inventory.balances.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-taupe">No Odoo warehouse stock is mirrored.</td></tr>}</tbody></table>
      </section>

      <section className="mb-8 overflow-x-auto rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Confirmed refill allocations</h2><p className="text-xs text-taupe">Mistakes are corrected through audited reversals; allocations are never deleted.</p></div>
        <table className="w-full min-w-[680px] text-sm"><thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe"><tr><th className="px-4 py-3">Confirmed</th><th className="px-4 py-3">Machine</th><th className="px-4 py-3">Lot</th><th className="px-4 py-3">Physical</th><th className="px-4 py-3">Stock</th><th className="px-4 py-3 text-right">Correction</th></tr></thead><tbody className="divide-y divide-line">{inventory.allocations.map((allocation) => <tr key={allocation.id}><td className="px-4 py-3 text-taupe">{formatDateTime(allocation.confirmedAt, tz)}</td><td className="px-4 py-3 font-semibold text-cocoa">{allocation.machineName}</td><td className="px-4 py-3 font-mono text-xs">{allocation.lotName}</td><td className="px-4 py-3">{allocation.quantity}</td><td className="px-4 py-3">{allocation.stockQuantity} {allocation.stockUnit}</td><td className="px-4 py-3"><VoidAllocationForm allocationId={allocation.id} /></td></tr>)}{inventory.allocations.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-taupe">No confirmed canonical allocations.</td></tr>}</tbody></table>
      </section>

      <section className="mb-8 overflow-x-auto rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Movement ledger</h2><p className="text-xs text-taupe">Append-only platform inventory history and independent Odoo state.</p></div>
        <table className="w-full min-w-[760px] text-sm"><thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Kind</th><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3">Lot</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3">Odoo</th><th className="px-4 py-3">Reason</th></tr></thead><tbody className="divide-y divide-line">{inventory.movements.map((movement) => <tr key={movement.id}><td className="px-4 py-3 text-taupe">{formatDateTime(movement.occurredAt, tz)}</td><td className="px-4 py-3 font-semibold text-cocoa">{movement.kind.replaceAll("_", " ")}</td><td className="px-4 py-3">{movement.warehouseName}</td><td className="px-4 py-3 font-mono text-xs">{movement.lotName}</td><td className={`px-4 py-3 text-right font-bold ${movement.quantity < 0 ? "text-danger" : "text-sage"}`}>{movement.quantity}</td><td className="px-4 py-3"><span className="rounded-full bg-cream px-2 py-1 text-[10px] font-bold uppercase text-taupe">{movement.syncStatus.replaceAll("_", " ")}</span>{movement.syncError && <p className="mt-1 text-xs text-danger">{movement.syncError}</p>}</td><td className="px-4 py-3 text-taupe">{movement.reason ?? "-"}</td></tr>)}{inventory.movements.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-taupe">No platform movements recorded.</td></tr>}</tbody></table>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Legacy tenant lots</h2><p className="text-xs text-taupe">Compatibility inventory from the original refill flow; not the Odoo warehouse authority.</p></div>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-5 py-3 font-bold">Lot</th>
              <th className="px-5 py-3 font-bold">Product</th>
              <th className="px-5 py-3 text-right font-bold">Qty</th>
              <th className="px-5 py-3 font-bold">Disposition</th>
              <th className="px-5 py-3 font-bold">Tenant</th>
              <th className="px-5 py-3 font-bold">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lots.map((l) => (
              <tr key={l.id} className="hover:bg-cream/50">
                <td className="px-5 py-3 font-semibold text-cocoa">{l.name}</td>
                <td className="px-5 py-3 text-taupe">{l.product_name ?? "—"}</td>
                <td className="px-5 py-3 text-right text-cocoa">{l.qty_available}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${TONE[l.disposition] ?? "bg-cream text-taupe"}`}>
                    {l.disposition}
                  </span>
                </td>
                <td className="px-5 py-3 text-taupe">{l.tenant_name ?? "—"}</td>
                <td className="px-5 py-3 text-taupe">
                  {formatDate(l.device_event_time, tz)}
                </td>
              </tr>
            ))}
            {lots.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-taupe">
                  No lots recorded yet. Lots are created from the restock (Reposición) flow.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
