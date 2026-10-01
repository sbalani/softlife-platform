import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { maskIban } from "@/lib/bank-details";
import { getFranchiseeIntakeSubmission } from "@/lib/data/franchisees";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { IntakeConversionForm } from "../../IntakeConversionForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-[11px] font-bold uppercase tracking-wide text-taupe">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-cocoa">{children || "Not supplied"}</dd></div>;
}

export default async function FranchiseeIntakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/dashboard");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [submission, timeZone] = await Promise.all([getFranchiseeIntakeSubmission(id), getDisplayTimezone()]);
  if (!submission) notFound();
  const assigned = submission.assigned_tenant_id && submission.assigned_modality && submission.assigned_share_percent;

  return (
    <div className="space-y-6">
      <div><Link href="/franchisees" className="text-sm font-bold text-terracotta">← Back to franchisees</Link><header className="mt-3"><div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-3xl font-bold text-cocoa">{submission.trade_name || submission.company_name || submission.contact_name}</h1><span className={`rounded-full px-3 py-1 text-xs font-bold ${submission.status === "processed" ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{submission.status}</span></div><p className="mt-1 text-sm text-taupe">Submitted {formatDateTime(submission.created_at, timeZone)}</p></header></div>

      <section className="rounded-2xl border border-line bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-lg font-bold text-cocoa">Accepted contract</h2><p className="mt-1 text-xs text-taupe">{submission.contract_version || "Version unavailable"}{submission.accepted_at ? ` · accepted ${formatDateTime(submission.accepted_at, timeZone)}` : " · not accepted"}</p></div><a href={`/api/franchisee-intake-contract/${submission.id}`} target="_blank" rel="noreferrer" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Download accepted PDF</a></div></section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-4 font-display text-lg font-bold text-cocoa">Business and location</h2><dl className="grid gap-4 sm:grid-cols-2"><Detail label="Legal entity">{submission.company_name}</Detail><Detail label="Trade name">{submission.trade_name}</Detail><Detail label="NIF / CIF">{submission.tax_id}</Detail><Detail label="Registered address">{submission.registered_address}</Detail><div className="sm:col-span-2"><Detail label="Proposed installation address">{submission.installation_address}</Detail></div></dl></section>
        <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-4 font-display text-lg font-bold text-cocoa">Representative</h2><dl className="grid gap-4 sm:grid-cols-2"><Detail label="Name">{submission.contact_name}</Detail><Detail label="Title / capacity">{submission.representative_title}</Detail><Detail label="Email">{submission.contact_email ? <a href={`mailto:${submission.contact_email}`} className="text-terracotta">{submission.contact_email}</a> : null}</Detail><Detail label="Phone"><a href={`tel:${submission.contact_phone}`} className="text-terracotta">{submission.contact_phone}</a></Detail></dl></section>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-4 font-display text-lg font-bold text-cocoa">Bank details</h2>{submission.bank_details_deferred ? <p className="text-sm text-warning">Bank details were deferred. Add them to the franchisee account before making payouts.</p> : <dl className="grid gap-4 sm:grid-cols-3"><Detail label="Account holder">{submission.account_holder_name}</Detail><Detail label="IBAN">{submission.iban ? maskIban(submission.iban) : null}</Detail><Detail label="BIC / SWIFT">{submission.bic_swift}</Detail></dl>}</section>

      {assigned ? <section className="rounded-2xl border border-sage/30 bg-sage/5 p-5"><h2 className="font-display text-lg font-bold text-cocoa">Franchisee account created</h2><p className="mt-1 text-sm text-cocoa">Modality {submission.assigned_modality} · {submission.assigned_share_percent}%{submission.assigned_at ? ` · assigned ${formatDateTime(submission.assigned_at, timeZone)}` : ""}</p><Link href={`/franchisees/${submission.assigned_tenant_id}`} className="mt-3 inline-block font-bold text-terracotta">Open franchisee account</Link></section> : submission.status === "pending" ? <section className="rounded-2xl border border-warning/40 bg-white p-5"><h2 className="mb-4 font-display text-lg font-bold text-cocoa">Create franchisee</h2><IntakeConversionForm submissionId={submission.id} /></section> : null}
    </div>
  );
}
