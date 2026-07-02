import { getProducts } from "@/lib/data/products";
import { getAllergens } from "@/lib/data/allergens";
import { ProductForm } from "./ProductForm";

export const dynamic = "force-dynamic";

const TYPE_TONE: Record<string, string> = {
  base: "bg-terracotta/15 text-terracotta",
  topping: "bg-sage/15 text-sage",
  sauce: "bg-rose/15 text-rose",
};

function AllergenBadges({ list, dim }: { list: { id: string; name: string; logo_url: string | null }[]; dim?: boolean }) {
  return (
    <>
      {list.map((a) =>
        a.logo_url ? (
          <img key={a.id} src={a.logo_url} alt={a.name} title={`${dim ? "may contain" : "contains"}: ${a.name}`} className={`h-5 w-5 object-contain ${dim ? "opacity-40" : ""}`} />
        ) : (
          <span key={a.id} title={`${dim ? "may contain" : "contains"}: ${a.name}`} className={`flex h-5 w-5 items-center justify-center rounded-full bg-sand text-[9px] font-bold text-taupe ${dim ? "opacity-40" : ""}`}>{a.name[0]}</span>
        ),
      )}
    </>
  );
}

export default async function IngredientsPage() {
  const [products, allergens] = await Promise.all([getProducts(), getAllergens()]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Ingredients</h1>
        <p className="mt-1 text-sm text-taupe">
          {products.length} ingredient{products.length === 1 ? "" : "s"} — the master catalog machines and hoppers pull from
        </p>
      </header>

      <details className="mb-6 rounded-2xl border border-line bg-white p-5">
        <summary className="cursor-pointer font-display text-lg font-bold text-cocoa">Add ingredient</summary>
        <div className="mt-4">
          <ProductForm allergens={allergens} />
        </div>
      </details>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => (
          <article key={p.id} className="rounded-2xl border border-line bg-white p-5">
            <div className="flex gap-4">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="h-16 w-16 rounded-xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-cream text-taupe">—</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate font-display text-lg font-bold text-cocoa">{p.name}</h2>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${TYPE_TONE[p.type] ?? "bg-cream text-taupe"}`}>{p.type}</span>
                </div>
                <p className="truncate text-xs text-taupe">{p.brand ? `${p.brand} · ` : ""}{p.sku ? `SKU ${p.sku}` : "—"}</p>
              </div>
            </div>

            {(p.allergens.contains.length > 0 || p.allergens.may_contain.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <AllergenBadges list={p.allergens.contains} />
                <AllergenBadges list={p.allergens.may_contain} dim />
              </div>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-taupe">Sale price</dt>
              <dd className="text-right font-semibold text-cocoa">€{p.price.toFixed(2)}</dd>
              {p.cost_per_kg != null && (<><dt className="text-taupe">Cost / kg</dt><dd className="text-right text-cocoa">€{p.cost_per_kg.toFixed(2)}</dd></>)}
              {p.default_portion_size != null && (<><dt className="text-taupe">Default portion</dt><dd className="text-right text-cocoa">{p.default_portion_size} g</dd></>)}
            </dl>

            {(p.nf_calories != null || p.nf_protein != null || p.nf_sugar != null) && (
              <p className="mt-3 border-t border-line pt-2 text-[11px] text-taupe">
                /100g: {p.nf_calories != null ? `${p.nf_calories} kcal · ` : ""}{p.nf_protein != null ? `P ${p.nf_protein}g · ` : ""}{p.nf_carbs != null ? `C ${p.nf_carbs}g · ` : ""}{p.nf_sugar != null ? `S ${p.nf_sugar}g · ` : ""}{p.nf_fat != null ? `F ${p.nf_fat}g` : ""}{p.nutritional_claim ? ` · ${p.nutritional_claim}` : ""}
              </p>
            )}
          </article>
        ))}
      </div>

      {products.length === 0 && (
        <p className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">No ingredients yet. Add bases, toppings and sauces above.</p>
      )}
    </div>
  );
}
