import { Fragment } from "react";
import { getFranchiseeIntakeSubmissions, getFranchiseeSignupRequests, getTenants } from "@/lib/data/franchisees";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { TenantForm } from "./TenantForm";
import { RemoteCommandPermissions } from "./RemoteCommandPermissions";
import { TenantDetailsForm } from "./TenantDetailsForm";
import { TenantContacts } from "./TenantContacts";
import { SignupRequestControls } from "./SignupRequestControls";

export const dynamic = "force-dynamic";

export default async function FranchiseesPage() {
  const [tenants, submissions, signupRequests] = await Promise.all([getTenants(), getFranchiseeIntakeSubmissions(), getFranchiseeSignupRequests()]);
  const tz = await getDisplayTimezone();
  const franchiseeOptions = tenants.filter((tenant) => tenant.kind === "franchisee").map(({ id, name }) => ({ id, name }));

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

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-cocoa">Franchisee user access</h2>
            <p className="mt-1 text-xs text-taupe">Public request URL: <span className="font-mono text-cocoa">/franchisee-signup</span>. Applicants cannot see account names; an admin assigns the correct franchisee here.</p>
          </div>
          <a href="/franchisee-signup" target="_blank" rel="noreferrer" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Open signup page</a>
        </div>
      </section>

      {signupRequests.length > 0 && (
        <section className="mb-6 rounded-2xl border border-warning/40 bg-white">
          <div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Pending access requests ({signupRequests.length})</h2></div>
          <div className="divide-y divide-line">{signupRequests.map((request) => <article key={request.id} className="flex flex-wrap items-start justify-between gap-4 p-5"><div className="min-w-0 flex-1"><div className="font-bold text-cocoa">{request.full_name}</div><a href={`mailto:${request.email}`} className="text-sm text-terracotta hover:underline">{request.email}</a>{request.phone && <a href={`tel:${request.phone}`} className="ml-3 text-sm text-taupe hover:text-terracotta">{request.phone}</a>}<p className="mt-1 text-xs text-taupe">{request.company_name || "No company supplied"} · submitted {formatDateTime(request.created_at, tz)}</p>{request.message && <p className="mt-2 max-w-xl rounded-lg bg-cream px-3 py-2 text-xs leading-5 text-cocoa">{request.message}</p>}</div><SignupRequestControls requestId={request.id} tenants={franchiseeOptions} /></article>)}</div>
        </section>
      )}

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
              <Fragment key={t.id}>
                <tr className="hover:bg-cream/50">
                  <td className="px-5 py-3 font-semibold text-cocoa">{t.name}{t.company_name && <span className="mt-0.5 block text-xs font-normal text-taupe">{t.company_name}</span>}</td>
                  <td className="px-5 py-3 capitalize text-cocoa">{t.kind}</td>
                  <td className="px-5 py-3 text-taupe">{formatDate(t.created_at, tz)}</td>
                  <td className="px-5 py-3">{t.kind === "franchisee" ? <RemoteCommandPermissions tenantId={t.id} initialCommands={t.remote_commands ?? ["operate_make"]} /> : "—"}</td>
                </tr>
                <tr><td colSpan={4} className="bg-cream/30 px-5 py-3"><details><summary className="cursor-pointer text-xs font-bold text-terracotta">Company details & contacts</summary><div className="mt-4 space-y-5"><TenantDetailsForm tenant={t} /><TenantContacts tenantId={t.id} contacts={t.tenant_contacts} /></div></details></td></tr>
              </Fragment>
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
