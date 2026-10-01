import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getTenantBankDetails, getTenantById } from "@/lib/data/franchisees";
import { TenantDetailsForm } from "../TenantDetailsForm";
import { TenantContacts } from "../TenantContacts";
import { TenantBankDetailsForm } from "../TenantBankDetailsForm";
import { RemoteCommandPermissions } from "../RemoteCommandPermissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function FranchiseeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/dashboard");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [tenant, bank] = await Promise.all([getTenantById(id), getTenantBankDetails(id)]);
  if (!tenant) notFound();
  return (
    <div>
      <Link href="/franchisees" className="text-sm font-bold text-terracotta">← Back to franchisees</Link>
      <header className="mb-6 mt-3"><h1 className="font-display text-3xl font-bold text-cocoa">{tenant.name}</h1><p className="mt-1 text-sm capitalize text-taupe">{tenant.kind} account</p></header>
      <div className="space-y-6">
        {tenant.kind === "franchisee" && tenant.source_intake_submission_id && <section className="rounded-2xl border border-sage/30 bg-sage/5 p-5"><h2 className="font-display text-lg font-bold text-cocoa">Onboarding assignment</h2><p className="mt-1 text-sm text-cocoa">Modality {tenant.onboarding_modality} · {tenant.onboarding_share_percent}%</p><div className="mt-3 flex flex-wrap gap-4 text-sm font-bold text-terracotta"><Link href={`/franchisees/intake/${tenant.source_intake_submission_id}`}>View accepted intake</Link><a href={`/api/franchisee-intake-contract/${tenant.source_intake_submission_id}`} target="_blank" rel="noreferrer">Download contract PDF</a></div></section>}
        <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-4 font-display text-lg font-bold text-cocoa">Company details</h2><TenantDetailsForm tenant={tenant} /></section>
        {tenant.kind === "franchisee" && <section className="rounded-2xl border border-line bg-white p-5"><h2 className="font-display text-lg font-bold text-cocoa">Bank and payout details</h2><p className="mb-4 mt-1 text-xs text-taupe">Company/autónomo name, NIF/CIF, and a valid bank account are required for payouts.</p><TenantBankDetailsForm tenantId={tenant.id} bank={bank} /></section>}
        <section className="rounded-2xl border border-line bg-white p-5"><TenantContacts tenantId={tenant.id} contacts={tenant.tenant_contacts} /></section>
        {tenant.kind === "franchisee" && <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-4 font-display text-lg font-bold text-cocoa">Remote-control permissions</h2><RemoteCommandPermissions tenantId={tenant.id} initialCommands={tenant.remote_commands ?? ["operate_make"]} /></section>}
      </div>
    </div>
  );
}
