import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getTenantBankDetails, getTenantById, getTenantContractInstallationAddress, tenantPostalAddress } from "@/lib/data/franchisees";
import { getCurrentTenantContractAcceptance } from "@/lib/data/franchisee-contract-acceptances";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { AccountForms } from "./AccountForms";
import { ContractAcceptanceForm } from "./ContractAcceptanceForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.role !== "franchisee" || !session.tenant_id) redirect("/dashboard");
  const [tenant, bank, locale, acceptance] = await Promise.all([getTenantById(session.tenant_id), getTenantBankDetails(session.tenant_id), getRequestLocale(), getCurrentTenantContractAcceptance(session.tenant_id)]);
  if (!tenant || tenant.kind !== "franchisee") redirect("/dashboard");
  const registeredAddress = tenantPostalAddress(tenant);
  const installationAddress = await getTenantContractInstallationAddress(tenant);
  const canAccept = Boolean(tenant.company_name && tenant.tax_id && registeredAddress && bank?.account_holder_name && bank.iban && session.full_name && session.email);
  const party = acceptance?.canonical_source?.manager ?? {
    representativeName: session.full_name ?? "",
    representativeEmail: session.email ?? "",
    representativePhone: "",
    representativeTitle: "",
    legalEntityName: tenant.company_name ?? "",
    taxId: tenant.tax_id ?? "",
    registeredAddress: registeredAddress ?? "",
    tradeName: tenant.name === tenant.company_name ? null : tenant.name,
    installationAddress: installationAddress ?? "",
    accountHolderName: bank?.account_holder_name ?? null,
    iban: bank?.iban ?? null,
    bicSwift: bank?.bic_swift ?? null,
    bankDetailsDeferred: false,
  };
  return (
    <div>
      <header className="mb-6"><h1 className="font-display text-3xl font-bold text-cocoa">{locale === "es" ? "Empresa y pagos" : "Company & payouts"}</h1><p className="mt-1 text-sm text-taupe">{tenant.name}</p></header>
      <div className="space-y-6">
        <AccountForms tenant={tenant} bank={bank} locale={locale} />
        <ContractAcceptanceForm party={party} acceptance={acceptance ? { id: acceptance.id, accepted_at: acceptance.accepted_at } : null} canAccept={canAccept} needsInstallationAddress={!installationAddress} />
      </div>
    </div>
  );
}
