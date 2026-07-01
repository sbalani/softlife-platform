import { getProducts } from "@/lib/data/products";
import { getTenants } from "@/lib/data/franchisees";
import { ProductForm } from "./ProductForm";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, tenants] = await Promise.all([getProducts(), getTenants()]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Products</h1>
        <p className="mt-1 text-sm text-taupe">
          {products.length} product{products.length === 1 ? "" : "s"} (bases, toppings, sauces)
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Add product</h2>
        <ProductForm tenants={tenants} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-5 py-3 font-bold">Name</th>
              <th className="px-5 py-3 font-bold">Type</th>
              <th className="px-5 py-3 font-bold">Belongs to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-cream/50">
                <td className="px-5 py-3 font-semibold text-cocoa">{p.name}</td>
                <td className="px-5 py-3 capitalize text-cocoa">{p.type}</td>
                <td className="px-5 py-3 text-taupe">{p.tenant_name ?? "—"}</td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-taupe">
                  No products yet — add bases, toppings and sauces above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
