import { getTransfers } from "@/lib/data/transfers";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const transfers = await getTransfers();

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Transfers</h1>
        <p className="mt-1 text-sm text-taupe">
          {transfers.length} machine transfer / delivery record{transfers.length === 1 ? "" : "s"}
        </p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
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
            {transfers.map((t) => (
              <tr key={t.id} className="hover:bg-cream/50">
                <td className="px-5 py-3 font-semibold text-cocoa">{t.name}</td>
                <td className="px-5 py-3 text-taupe">{new Date(t.date).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-cocoa">{t.machine_name ?? "—"}</td>
                <td className="px-5 py-3 text-taupe">{t.from_tenant ?? "—"}</td>
                <td className="px-5 py-3 text-cocoa">{t.to_tenant ?? "—"}</td>
                <td className="px-5 py-3 text-taupe">{t.note ?? "—"}</td>
              </tr>
            ))}
            {transfers.length === 0 && (
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
