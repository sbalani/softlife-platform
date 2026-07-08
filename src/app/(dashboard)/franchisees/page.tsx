import { getTenants } from "@/lib/data/franchisees";
import { TenantForm } from "./TenantForm";

export const dynamic = "force-dynamic";

export default async function FranchiseesPage() {
  const tenants = await getTenants();

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Franchisees</h1>
        <p className="mt-1 text-sm text-taupe">
          {tenants.length} franchisee / customer account{tenants.length === 1 ? "" : "s"}
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Add franchisee / customer</h2>
        <TenantForm />
      </section>

      <section className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-5 py-3 font-bold">Name</th>
              <th className="px-5 py-3 font-bold">Kind</th>
              <th className="px-5 py-3 font-bold">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-cream/50">
                <td className="px-5 py-3 font-semibold text-cocoa">{t.name}</td>
                <td className="px-5 py-3 capitalize text-cocoa">{t.kind}</td>
                <td className="px-5 py-3 text-taupe">
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-taupe">
                  No franchisees yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
