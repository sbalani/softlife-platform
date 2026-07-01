import { getLots } from "@/lib/data/lots";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  released: "bg-sage/15 text-sage",
  hold: "bg-warning/15 text-warning",
  dispose: "bg-danger/15 text-danger",
};

export default async function InventoryPage() {
  const lots = await getLots();

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Inventory</h1>
        <p className="mt-1 text-sm text-taupe">{lots.length} lot(s) on hand</p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
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
                  {l.device_event_time ? new Date(l.device_event_time).toLocaleDateString() : "—"}
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
