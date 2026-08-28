import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getFranchiseeIntakeSubmissions, getFranchiseeSignupRequests, getTenantSummaries } from "@/lib/data/franchisees";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { maskIban } from "@/lib/bank-details";
import { TenantForm } from "./TenantForm";
import { SignupRequestControls } from "./SignupRequestControls";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; kind?: string; page?: string };

function pageHref(page: number, q: string, kind: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (kind !== "all") params.set("kind", kind);
  params.set("page", String(page));
  return `/franchisees?${params}`;
}

export default async function FranchiseesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/dashboard");
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const kind = params.kind === "internal" || params.kind === "franchisee" ? params.kind : "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 20;
  const [tenants, submissions, signupRequests, tz] = await Promise.all([getTenantSummaries(), getFranchiseeIntakeSubmissions(), getFranchiseeSignupRequests(), getDisplayTimezone()]);
  const franchiseeOptions = tenants.filter((tenant) => tenant.kind === "franchisee").map(({ id, name }) => ({ id, name }));
  const filtered = tenants.filter((tenant) => (kind === "all" || tenant.kind === kind) && (!q || [tenant.name, tenant.company_name, tenant.contact_email, tenant.contact_phone, tenant.city, tenant.country].some((value) => value?.toLowerCase().includes(q))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="font-display text-3xl font-bold text-cocoa">Franchisees</h1><p className="mt-1 text-sm text-taupe">{filtered.length} matching account{filtered.length === 1 ? "" : "s"}</p></div>
        <form className="flex flex-wrap items-end gap-2"><label className="text-xs text-taupe"><span className="mb-1 block uppercase">Search</span><input name="q" defaultValue={params.q ?? ""} placeholder="Name, email, city..." className="w-64 rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" /></label><label className="text-xs text-taupe"><span className="mb-1 block uppercase">Kind</span><select name="kind" defaultValue={kind} className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="all">All</option><option value="franchisee">Franchisee</option><option value="internal">Internal</option></select></label><button className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Filter</button></form>
      </header>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-lg font-bold text-cocoa">Team intake form</h2><p className="mt-1 text-xs text-taupe">Public URL: <span className="font-mono text-cocoa">/franchisee-intake</span></p></div><a href="/franchisee-intake" target="_blank" rel="noreferrer" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Open form</a></div></section>
        <section className="rounded-2xl border border-line bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-lg font-bold text-cocoa">User access signup</h2><p className="mt-1 text-xs text-taupe">Public URL: <span className="font-mono text-cocoa">/franchisee-signup</span></p></div><a href="/franchisee-signup" target="_blank" rel="noreferrer" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Open signup</a></div></section>
      </div>

      {signupRequests.length > 0 && <section className="mb-6 rounded-2xl border border-warning/40 bg-white"><div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Pending access requests ({signupRequests.length})</h2></div><div className="divide-y divide-line">{signupRequests.map((request) => <article key={request.id} className="flex flex-wrap items-start justify-between gap-4 p-5"><div className="min-w-0 flex-1"><div className="font-bold text-cocoa">{request.full_name}</div><a href={`mailto:${request.email}`} className="text-sm text-terracotta hover:underline">{request.email}</a>{request.phone && <a href={`tel:${request.phone}`} className="ml-3 text-sm text-taupe">{request.phone}</a>}<p className="mt-1 text-xs text-taupe">{request.company_name || "Company details not supplied"}{request.tax_id ? ` · ${request.tax_id}` : ""} · submitted {formatDateTime(request.created_at, tz)}</p>{request.iban && <p className="mt-1 text-xs font-semibold text-cocoa">Bank supplied: {maskIban(request.iban)}</p>}{request.message && <p className="mt-2 max-w-xl rounded-lg bg-cream px-3 py-2 text-xs text-cocoa">{request.message}</p>}</div><SignupRequestControls requestId={request.id} tenants={franchiseeOptions} /></article>)}</div></section>}

      {submissions.length > 0 && <section className="mb-6 overflow-x-auto rounded-2xl border border-warning/40 bg-white"><div className="border-b border-line px-5 py-4"><h2 className="font-display text-lg font-bold text-cocoa">Pending intake submissions ({submissions.length})</h2></div><table className="w-full min-w-[900px] text-sm"><thead className="bg-warning/10 text-left text-[11px] uppercase text-taupe"><tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Business</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">Bank</th><th className="px-5 py-3">Submitted</th></tr></thead><tbody className="divide-y divide-line">{submissions.map((submission) => <tr key={submission.id}><td className="px-5 py-3 font-semibold text-cocoa">{submission.contact_name}</td><td className="px-5 py-3 text-cocoa">{submission.trade_name || submission.company_name || "Not supplied"}</td><td className="px-5 py-3">{submission.contact_email ? <a href={`mailto:${submission.contact_email}`} className="text-terracotta">{submission.contact_email}</a> : <span className="text-warning">Missing</span>}</td><td className="px-5 py-3"><a href={`tel:${submission.contact_phone}`} className="text-terracotta">{submission.contact_phone}</a></td><td className="px-5 py-3 font-mono text-xs">{submission.iban ? maskIban(submission.iban) : "—"}</td><td className="px-5 py-3 text-taupe">{formatDateTime(submission.created_at, tz)}</td></tr>)}</tbody></table></section>}

      <section className="mb-6 rounded-2xl border border-line bg-white p-5"><h2 className="mb-4 font-display text-lg font-bold text-cocoa">Add account</h2><TenantForm /></section>

      <section className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[760px] text-sm"><thead className="bg-sand/60 text-left text-[11px] uppercase text-taupe"><tr><th className="px-5 py-3">Account</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Location</th><th className="px-5 py-3">Payout</th><th className="px-5 py-3">Created</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-line">{rows.map((tenant) => <tr key={tenant.id} className="hover:bg-cream/50"><td className="px-5 py-3"><Link href={`/franchisees/${tenant.id}`} className="font-bold text-cocoa hover:text-terracotta hover:underline">{tenant.name}</Link><span className="block text-xs text-taupe">{tenant.company_name || tenant.kind}</span></td><td className="px-5 py-3 text-xs"><div>{tenant.contact_email || "—"}</div><div className="text-taupe">{tenant.contact_phone || "—"}</div></td><td className="px-5 py-3 text-taupe">{[tenant.city, tenant.country].filter(Boolean).join(", ") || "—"}</td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tenant.kind !== "franchisee" ? "bg-taupe/10 text-taupe" : tenant.payout_ready ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{tenant.kind !== "franchisee" ? "N/A" : tenant.payout_ready ? "Ready" : "Incomplete"}</span></td><td className="px-5 py-3 text-taupe">{formatDate(tenant.created_at, tz)}</td><td className="px-5 py-3 text-right"><Link href={`/franchisees/${tenant.id}`} className="font-bold text-terracotta">View details</Link></td></tr>)}{!rows.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-taupe">No accounts match these filters.</td></tr>}</tbody></table>
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-taupe"><span>Page {safePage} of {totalPages}</span><div className="flex gap-2">{safePage > 1 ? <Link href={pageHref(safePage - 1, params.q ?? "", kind)} className="rounded-lg border border-line px-3 py-1.5">Prev</Link> : <span className="rounded-lg border border-line px-3 py-1.5 opacity-40">Prev</span>}{safePage < totalPages ? <Link href={pageHref(safePage + 1, params.q ?? "", kind)} className="rounded-lg border border-line px-3 py-1.5">Next</Link> : <span className="rounded-lg border border-line px-3 py-1.5 opacity-40">Next</span>}</div></div>
      </section>
    </div>
  );
}
