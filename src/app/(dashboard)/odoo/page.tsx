import { getOdooSkus, getOdooLots } from "@/lib/data/odoo";
import { DataSourceNote } from "@/components/data-source-note";
import { CreateIngredientButton } from "./CreateIngredientButton";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getProductionAdminData } from "@/lib/data/odoo-production-admin";
import { resolveProductionLine, saveProductionDefault, saveProductionProduct, saveProductionSettings, saveWarehouseCustomer } from "./actions";
import { ProductionRunsPanel } from "./ProductionRunsPanel";

export const dynamic = "force-dynamic";

export default async function OdooPage() {
  const [{ skus, source: skuSource }, { lots, source: lotSource }, production] = await Promise.all([
    getOdooSkus(),
    getOdooLots(),
    getProductionAdminData(),
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

      <section className="mb-8 rounded-2xl border border-line bg-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-display text-xl font-bold text-cocoa">Production contract</h2><p className="mt-1 text-xs text-taupe">Configure deterministic consumption, resolve unmatched sales, and freeze shared manufacturing runs.</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${production.available ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{production.available ? "Contract ready" : "Migration pending"}</span>
        </div>
        {!production.available ? <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">Apply the Odoo manufacturing contract migration before configuring production.</p> : (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-line p-4">
                <h3 className="mb-3 text-sm font-bold text-cocoa">Global portions</h3>
                <div className="space-y-2">{["base", "solid_topping", "liquid_topping"].map((type) => {
                  const current = production.defaults.find((item) => item.consumption_type === type);
                  return <form action={saveProductionDefault} key={type} className="grid grid-cols-[1fr_6rem_5rem_auto] items-end gap-2"><input type="hidden" name="consumption_type" value={type} /><label className="text-xs text-taupe"><span className="mb-1 block capitalize">{type.replaceAll("_", " ")}</span><span className="block rounded-lg bg-cream px-3 py-2 text-cocoa">Per sale</span></label><label className="text-xs text-taupe"><span className="mb-1 block">Quantity</span><input name="quantity" type="number" min="0.001" step="0.001" required defaultValue={current?.quantity ?? ""} className="w-full rounded-lg border border-line px-2 py-2 text-cocoa" /></label><label className="text-xs text-taupe"><span className="mb-1 block">UoM</span><input name="uom" required defaultValue={current?.uom ?? "g"} className="w-full rounded-lg border border-line px-2 py-2 text-cocoa" /></label><button className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white">Save</button></form>;
                })}</div>
              </div>
              <div className="rounded-xl border border-line p-4">
                <h3 className="mb-3 text-sm font-bold text-cocoa">Cup and currency</h3>
                <form action={saveProductionSettings} className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end"><label className="text-xs text-taupe"><span className="mb-1 block">Cup Odoo SKU</span><select name="cup_odoo_product_id" defaultValue={production.settings?.cup_odoo_product_id ?? ""} className="w-full rounded-lg border border-line px-2 py-2 text-cocoa"><option value="">Not configured</option>{production.odooProducts.map((product) => <option key={product.odoo_id} value={product.odoo_id}>{product.name}{product.sku ? ` · ${product.sku}` : ""} · Odoo ID ${product.odoo_id}</option>)}</select><span className="mt-1 block text-[10px] leading-4">Adds exactly 1 unit to every BOM. This SKU is not a food ingredient.</span></label><label className="text-xs text-taupe"><span className="mb-1 block">Currency</span><input name="currency" maxLength={3} defaultValue={production.settings?.currency ?? "EUR"} className="w-full rounded-lg border border-line px-2 py-2 uppercase text-cocoa" /></label><button className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white">Save</button></form>
              </div>
            </div>

            <details className="rounded-xl border border-line"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-cocoa">Ingredient consumption overrides ({production.products.length})</summary><div className="max-h-[28rem] overflow-auto border-t border-line"><table className="w-full min-w-[720px] text-xs"><thead className="sticky top-0 bg-sand text-left uppercase text-taupe"><tr><th className="px-3 py-2">Ingredient</th><th>Odoo</th><th>Type</th><th>Override</th><th>UoM</th><th /></tr></thead><tbody className="divide-y divide-line">{production.products.map((product) => <tr key={product.id}><td className="px-3 py-2 font-semibold text-cocoa">{product.name}</td><td className="text-taupe">{product.odoo_id ?? "Missing"}</td><td colSpan={4}><form action={saveProductionProduct} className="grid grid-cols-[10rem_7rem_5rem_auto] items-center gap-2 py-1"><input type="hidden" name="product_id" value={product.id} /><select name="consumption_type" defaultValue={product.consumption_type ?? ""} className="rounded border border-line px-2 py-1.5"><option value="">Unclassified</option><option value="base">Base</option><option value="solid_topping">Solid topping</option><option value="liquid_topping">Liquid topping</option></select><input name="quantity" type="number" min="0.001" step="0.001" defaultValue={product.override_quantity ?? ""} placeholder="Use type default" className="rounded border border-line px-2 py-1.5" /><input name="uom" defaultValue={product.override_uom ?? ""} placeholder="g" className="rounded border border-line px-2 py-1.5" /><button className="text-xs font-bold text-terracotta">Save</button></form></td></tr>)}</tbody></table></div></details>

            <details className="rounded-xl border border-line"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-cocoa">Warehouse sales customers</summary><div className="grid gap-2 border-t border-line p-4 sm:grid-cols-2">{production.warehouses.map((warehouse) => <form action={saveWarehouseCustomer} key={warehouse.odoo_id} className="flex items-end gap-2 rounded-lg bg-cream/60 p-3"><input type="hidden" name="warehouse_id" value={warehouse.odoo_id} /><label className="min-w-0 flex-1 text-xs text-taupe"><span className="mb-1 block truncate">{warehouse.name}</span><input name="customer_id" type="number" min="1" defaultValue={warehouse.sales_customer_odoo_id ?? ""} placeholder="Odoo customer ID" className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label><button className="rounded bg-cocoa px-3 py-1.5 text-xs font-bold text-white">Save</button></form>)}</div></details>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-line p-4"><h3 className="text-sm font-bold text-cocoa">Pending sale resolution ({production.pending.length})</h3><div className="mt-3 max-h-80 space-y-2 overflow-auto">{production.pending.length ? production.pending.map((item) => <form action={resolveProductionLine} key={item.id} className="rounded-lg bg-cream/60 p-3"><input type="hidden" name="resolution_id" value={item.id} /><div className="mb-1 flex justify-between gap-2 text-xs"><span className="font-semibold text-cocoa">{item.raw_name || "Empty product name"}</span><span className="text-taupe">{item.order_code}</span></div><p className="mb-2 text-[10px] text-taupe">Normalized: {item.normalized_name || "—"} · {item.machine_name || "Unknown machine"} · {item.menu_kind || "unknown kind"}:{item.raw_position || "no position"}</p><div className="flex gap-2"><select name="choice" required className="min-w-0 flex-1 rounded border border-line px-2 py-1.5 text-xs"><option value="">Choose an explicit resolution</option><optgroup label="Canonical ingredient">{production.products.map((product) => <option key={product.id} value={`product:${product.id}`}>{product.name}</option>)}</optgroup><optgroup label="Complete recipe">{production.recipes.map((recipe) => <option key={recipe.id} value={`recipe:${recipe.id}`}>{recipe.name}</option>)}</optgroup><option value="ignored">Ignore with reason</option></select><button className="rounded bg-terracotta px-3 py-1.5 text-xs font-bold text-white">Resolve</button></div><input name="resolution_note" placeholder="Required reason when ignoring" className="mt-2 w-full rounded border border-line px-2 py-1.5 text-xs" /><p className="mt-1 text-[10px] text-warning">{item.problem_code?.replaceAll("_", " ")}</p></form>) : <p className="text-sm text-sage">No unresolved sale lines.</p>}</div></div>
              <ProductionRunsPanel runs={production.runs} timeZone={tz} />
            </div>
          </div>
        )}
      </section>

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
