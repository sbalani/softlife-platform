import { formatDateTime } from "@/lib/dates";
import type { ProductionAdminData } from "@/lib/data/odoo-production-admin";
import { requestOdooStockSync } from "./actions";
import { OdooSaveForm } from "./OdooSaveForm";

type Snapshot = NonNullable<ProductionAdminData["stockSnapshot"]>;
const EPOCH = "1970-01-01T00:00:00.000Z";

function ageLabel(timestamp: string | null, checkedAt: string) {
  if (!timestamp) return "Never received";
  const minutes = Math.max(0, Math.floor((Date.parse(checkedAt) - Date.parse(timestamp)) / 60_000));
  if (minutes < 1) return "Less than a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export function StockSnapshotPanel({ snapshot, timeZone, sourceWarehouseId }: {
  snapshot: Snapshot | null; timeZone: string; sourceWarehouseId: number | null;
}) {
  const observedAt = snapshot?.warehouseProductObservedAt ?? null;
  const age = observedAt && snapshot ? Date.parse(snapshot.checkedAt) - Date.parse(observedAt) : Number.POSITIVE_INFINITY;
  const sourceWarehouse = snapshot?.warehouseRows.find((warehouse) => warehouse.odoo_warehouse_id === sourceWarehouseId);
  const ready = Boolean(snapshot && observedAt && age <= 2 * 60 * 60_000
    && sourceWarehouseId && sourceWarehouse?.stock_location_id && sourceWarehouse.product_rows > 0);
  const request = snapshot?.latestRequest;
  const requestSummary = request?.result?.summary == null ? null : String(request.result.summary);
  return <section className="mb-8 rounded-2xl border border-line bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-bold text-cocoa">Warehouse stock snapshot</h2>
        <p className="mt-1 text-xs text-taupe">Manufacturing uses this warehouse-level available stock and these lot balances, not the global SKU quantity.</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${ready ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>
        {ready ? "Fresh and ready" : !sourceWarehouseId ? "Source not configured" : observedAt ? "Stale or incomplete" : "Missing"}
      </span>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl bg-cream/60 p-3"><p className="text-[10px] font-bold uppercase text-taupe">Availability observed</p><p className="mt-1 font-semibold text-cocoa">{observedAt ? formatDateTime(observedAt, timeZone) : "Never"}</p><p className="text-[10px] text-taupe">{ageLabel(observedAt, snapshot?.checkedAt ?? EPOCH)}; maximum age is 2 hours</p></div>
      <div className="rounded-xl bg-cream/60 p-3"><p className="text-[10px] font-bold uppercase text-taupe">Warehouse-product rows</p><p className="mt-1 text-xl font-bold text-cocoa">{snapshot?.warehouseProductRows ?? 0}</p><p className="text-[10px] text-taupe">Includes tracked and untracked products</p></div>
      <div className="rounded-xl bg-cream/60 p-3"><p className="text-[10px] font-bold uppercase text-taupe">Available lot rows</p><p className="mt-1 text-xl font-bold text-cocoa">{snapshot?.lotStockRows ?? 0}</p><p className="text-[10px] text-taupe">Observed {snapshot?.lotStockObservedAt ? formatDateTime(snapshot.lotStockObservedAt, timeZone) : "never"}</p></div>
      <div className="rounded-xl bg-cream/60 p-3"><p className="text-[10px] font-bold uppercase text-taupe">Mirrored metadata</p><p className="mt-1 font-semibold text-cocoa">{snapshot?.products ?? 0} products / {snapshot?.warehouses ?? 0} warehouses</p><p className="text-[10px] text-taupe">{snapshot?.trackedProducts ?? 0} lot or serial tracked products</p></div>
    </div>

    <div className="mt-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[600px] text-xs">
        <thead className="bg-sand/50 text-left uppercase text-taupe"><tr><th className="px-3 py-2">Warehouse</th><th>Odoo ID</th><th>Stock location</th><th>Product balances</th><th>Available lots</th></tr></thead>
        <tbody className="divide-y divide-line">{(snapshot?.warehouseRows ?? []).map((warehouse) => <tr key={warehouse.odoo_warehouse_id} className={warehouse.odoo_warehouse_id === sourceWarehouseId ? "bg-sage/5" : ""}>
          <td className="px-3 py-2 font-semibold text-cocoa">{warehouse.name}{warehouse.odoo_warehouse_id === sourceWarehouseId ? " (central source)" : ""}</td>
          <td>{warehouse.odoo_warehouse_id}</td><td>{warehouse.stock_location_id ?? "Missing"}</td><td>{warehouse.product_rows}</td><td>{warehouse.lot_rows}</td>
        </tr>)}</tbody>
      </table>
      {!snapshot?.warehouseRows.length && <p className="p-3 text-sm text-warning">No Odoo warehouses are mirrored.</p>}
    </div>

    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
      <div className="rounded-xl border border-line p-3 text-xs">
        <p className="font-bold text-cocoa">Latest platform-requested sync</p>
        {!request ? <p className="mt-1 text-taupe">No sync has been requested from this page.</p> : <div className="mt-1 space-y-1 text-taupe">
          <p><span className="font-semibold uppercase text-cocoa">{request.status}</span> - requested {formatDateTime(request.requested_at, timeZone)} - attempts {request.attempts}</p>
          {request.claimed_at && <p>Odoo claimed it at {formatDateTime(request.claimed_at, timeZone)}.</p>}
          {request.completed_at && <p>Finished at {formatDateTime(request.completed_at, timeZone)}.</p>}
          {requestSummary && <p className="whitespace-pre-wrap text-cocoa">{requestSummary}</p>}
          {request.error && <p className="whitespace-pre-wrap font-semibold text-danger">{request.error}</p>}
          <p className="break-all font-mono text-[9px]">{request.id}</p>
        </div>}
      </div>
      <OdooSaveForm action={requestOdooStockSync} className="flex max-w-md flex-col gap-2 rounded-xl border border-terracotta/30 bg-terracotta/5 p-3">
        <p className="text-[11px] text-cocoa">Queues the same full sync as Odoo&apos;s Sync now button. The connector checks for requests every minute and reports the exact result above.</p>
        <button className="rounded-lg bg-terracotta px-4 py-2 text-xs font-bold text-white">Request full Odoo stock sync</button>
      </OdooSaveForm>
    </div>
  </section>;
}
