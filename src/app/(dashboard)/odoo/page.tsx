import { getOdooSkus, getOdooLots } from "@/lib/data/odoo";
import { DataSourceNote } from "@/components/data-source-note";
import { CreateIngredientButton } from "./CreateIngredientButton";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function OdooPage() {
  const [{ skus, source: skuSource }, { lots, source: lotSource }] = await Promise.all([
    getOdooSkus(),
    getOdooLots(),
  ]);

  const tz = await getDisplayTimezone();
  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-cocoa">Odoo</h1>
        <p className="mt-1 text-sm text-taupe">
          SKUs and lots mirrored from Odoo, refreshed hourly by the softlife_sync cron.
          Odoo is the system of record for this data — the platform only reads it here.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">SKUs ({skus.length})</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line bg-sand/40 text-left text-[11px] uppercase tracking-wide text-taupe">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">On hand</th>
                <th className="px-4 py-3 text-right">Ingredient</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold text-cocoa">{s.name}</td>
                  <td className="px-4 py-3 text-taupe">{s.sku ?? "—"}</td>
                  <td className="px-4 py-3 text-taupe">{s.barcode ?? "—"}</td>
                  <td className="px-4 py-3 text-taupe">{s.category ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-cocoa">
                    {s.qty_available} {s.uom ?? ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.linked_product_id ? (
                      <span className="text-xs font-semibold text-sage">⇄ {s.linked_product_name}</span>
                    ) : (
                      <CreateIngredientButton odooId={s.id} />
                    )}
                  </td>
                </tr>
              ))}
              {skus.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-taupe">No SKUs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <DataSourceNote source={skuSource} />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Lots ({lots.length})</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line bg-sand/40 text-left text-[11px] uppercase tracking-wide text-taupe">
                <th className="px-4 py-3">Lot</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold text-cocoa">{l.name}</td>
                  <td className="px-4 py-3 text-taupe">{l.product_name ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-cocoa">{l.qty}</td>
                  <td className="px-4 py-3 text-taupe">{l.expiration_date ?? "—"}</td>
                  <td className="px-4 py-3 text-taupe">{l.warehouse_name ?? "—"}</td>
                  <td className="px-4 py-3 text-taupe">
                    {l.updated_at ? formatDateTime(l.updated_at, tz) : "—"}
                  </td>
                </tr>
              ))}
              {lots.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-taupe">No lots found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <DataSourceNote source={lotSource} />
      </section>
    </div>
  );
}
