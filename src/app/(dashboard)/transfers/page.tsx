import { getTransfers } from "@/lib/data/transfers";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getInventoryTransferWorkspace } from "@/lib/inventory-transfers";
import { WarehouseTransferForm } from "@/components/WarehouseTransferForm";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const [machineTransfers, inventory, tz] = await Promise.all([getTransfers(), getInventoryTransferWorkspace(), getDisplayTimezone()]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-cocoa">Transfers</h1>
        <p className="mt-1 text-sm text-taupe">Move product from the configured central warehouse to a subwarehouse, with lot traceability and Odoo status.</p>
      </header>

      <WarehouseTransferForm workspace={inventory} />

      <section className="mt-8 overflow-x-auto rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Product transfer history</h2><p className="text-xs text-taupe">Each row represents the paired outbound and inbound movement for one Odoo internal transfer.</p></div>
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">Product / lot</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3">Odoo</th><th className="px-4 py-3">Reason</th></tr></thead>
          <tbody className="divide-y divide-line">
            {inventory.transfers.map((transfer) => <tr key={transfer.id}><td className="px-4 py-3 text-taupe">{formatDateTime(transfer.occurredAt, tz)}</td><td className="px-4 py-3"><span className="font-semibold text-cocoa">{transfer.sourceWarehouse}</span><span className="mx-2 text-taupe">to</span><span className="font-semibold text-cocoa">{transfer.destinationWarehouse}</span></td><td className="px-4 py-3"><span className="block text-cocoa">{transfer.productName}</span><span className="font-mono text-xs text-taupe">{transfer.lotName}</span></td><td className="px-4 py-3 text-right font-bold text-cocoa">{transfer.quantity}</td><td className="px-4 py-3"><span className="rounded-full bg-cream px-2 py-1 text-[10px] font-bold uppercase text-taupe">{transfer.syncStatus.replaceAll("_", " ")}</span>{transfer.syncError && <p className="mt-1 max-w-xs text-xs text-danger">{transfer.syncError}</p>}</td><td className="px-4 py-3 text-taupe">{transfer.reason}</td></tr>)}
            {!inventory.transfers.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-taupe">No product transfers recorded yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="mt-8 overflow-x-auto rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Machine delivery history</h2><p className="text-xs text-taupe">Ownership and delivery records are kept separately from product stock movements.</p></div>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-5 py-3 font-bold">Ref</th>
              <th className="px-5 py-3 font-bold">Date</th>
              <th className="px-5 py-3 font-bold">Machine</th>
              <th className="px-5 py-3 font-bold">From</th>
              <th className="px-5 py-3 font-bold">To</th>
              <th className="px-5 py-3 font-bold">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {machineTransfers.map((t) => (
              <tr key={t.id} className="hover:bg-cream/50">
                <td className="px-5 py-3 font-semibold text-cocoa">{t.name}</td>
                <td className="px-5 py-3 text-taupe">{formatDate(t.date, tz)}</td>
                <td className="px-5 py-3 text-cocoa">{t.machine_name ?? "—"}</td>
                <td className="px-5 py-3 text-taupe">{t.from_tenant ?? "—"}</td>
                <td className="px-5 py-3 text-cocoa">{t.to_tenant ?? "—"}</td>
                <td className="px-5 py-3 text-taupe">{t.note ?? "—"}</td>
              </tr>
            ))}
            {machineTransfers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-taupe">
                  No transfers yet. Delivery records appear here when a machine is reassigned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
