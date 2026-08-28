import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getTenantBankDetails, getTenantById } from "@/lib/data/franchisees";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { AccountForms } from "./AccountForms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.role !== "franchisee" || !session.tenant_id) redirect("/dashboard");
  const [tenant, bank, locale] = await Promise.all([getTenantById(session.tenant_id), getTenantBankDetails(session.tenant_id), getRequestLocale()]);
  if (!tenant || tenant.kind !== "franchisee") redirect("/dashboard");
  return (
    <div>
      <header className="mb-6"><h1 className="font-display text-3xl font-bold text-cocoa">{locale === "es" ? "Empresa y pagos" : "Company & payouts"}</h1><p className="mt-1 text-sm text-taupe">{tenant.name}</p></header>
      <AccountForms tenant={tenant} bank={bank} locale={locale} />
    </div>
  );
}
