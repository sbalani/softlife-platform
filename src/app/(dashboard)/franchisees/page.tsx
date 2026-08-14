import { getFranchiseeIntakeSubmissions, getTenants } from "@/lib/data/franchisees";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { TenantForm } from "./TenantForm";
import { RemoteCommandPermissions } from "./RemoteCommandPermissions";

export const dynamic = "force-dynamic";

export default async function FranchiseesPage() {
  const [tenants, submissions] = await Promise.all([getTenants(), getFranchiseeIntakeSubmissions()]);
  const tz = await getDisplayTimezone();

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Franchisees</h1>
        <p className="mt-1 text-sm text-taupe">
          {tenants.length} franchisee / customer account{tenants.length === 1 ? "" : "s"}
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-cocoa">Team intake form</h2>
            <p className="mt-1 text-xs text-taupe">Share this public URL with team members: <span className="font-mono text-cocoa">/franchisee-intake</span></p>
          </div>
          <a href="/franchisee-intake" target="_blank" rel="noreferrer" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Open form</a>
        </div>
      </section>

      {submissions.length > 0 && (
        <section className="mb-6 overflow-x-auto rounded-2xl border border-warning/40 bg-white">
          <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Pending intake submissions ({submissions.length})</h2></div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-warning/10 text-left text-[11px] uppercase tracking-wide text-taupe"><tr><th className="px-5 py-3">Trade name</th><th className="px-5 py-3">Company</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">Submitted</th></tr></thead>
            <tbody className="divide-y divide-line">{submissions.map((submission) => <tr key={submission.id}><td className="px-5 py-3 font-semibold text-cocoa">{submission.trade_name}</td><td className="px-5 py-3 text-cocoa">{submission.company_name}</td><td className="px-5 py-3 text-cocoa">{submission.contact_name}</td><td className="px-5 py-3"><a href={`tel:${submission.contact_phone}`} className="font-semibold text-terracotta">{submission.contact_phone}</a></td><td className="px-5 py-3 text-taupe">{formatDateTime(submission.created_at, tz)}</td></tr>)}</tbody>
          </table>
        </section>
      )}

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
              <th className="px-5 py-3 font-bold">Franchise controls</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-cream/50">
                <td className="px-5 py-3 font-semibold text-cocoa">{t.name}</td>
                <td className="px-5 py-3 capitalize text-cocoa">{t.kind}</td>
                <td className="px-5 py-3 text-taupe">
                  {formatDate(t.created_at, tz)}
                </td>
                <td className="px-5 py-3">{t.kind === "franchisee" ? <RemoteCommandPermissions tenantId={t.id} initialCommands={t.remote_commands ?? ["operate_make"]} /> : "—"}</td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-taupe">
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
