"use client";

import { useActionState } from "react";
import type { Tenant, TenantBankDetails } from "@/lib/data/franchisees";
import type { Locale } from "@/lib/i18n/locale";
import { saveOwnBankDetails, saveOwnCompanyDetails, type AccountResult } from "./actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe";

export function AccountForms({ tenant, bank, locale }: { tenant: Tenant; bank: TenantBankDetails | null; locale: Locale }) {
  const [companyResult, companyAction, companyPending] = useActionState<AccountResult | null, FormData>(saveOwnCompanyDetails, null);
  const [bankResult, bankAction, bankPending] = useActionState<AccountResult | null, FormData>(saveOwnBankDetails, null);
  const es = locale === "es";
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">{es ? "Empresa y datos fiscales" : "Company and tax details"}</h2>
        <p className="mb-4 mt-1 text-xs text-taupe">{es ? "El nombre legal y el NIF/CIF son obligatorios para recibir pagos." : "Legal company/autónomo name and NIF/CIF are required before payouts can be made."}</p>
        <form action={companyAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label><span className={label}>{es ? "Empresa / autónomo" : "Company / autónomo name"}</span><input name="company_name" maxLength={150} defaultValue={tenant.company_name ?? ""} className={input} /></label>
          <label><span className={label}>NIF / CIF</span><input name="tax_id" maxLength={50} defaultValue={tenant.tax_id ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Email de empresa" : "Company email"}</span><input name="contact_email" type="email" maxLength={254} defaultValue={tenant.contact_email ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Teléfono" : "Company phone"}</span><input name="contact_phone" maxLength={40} inputMode="tel" defaultValue={tenant.contact_phone ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Web" : "Website"}</span><input name="website" type="url" maxLength={300} placeholder="https://" defaultValue={tenant.website ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Dirección" : "Address"}</span><input name="address_line_1" maxLength={200} defaultValue={tenant.address_line_1 ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Dirección 2" : "Address line 2"}</span><input name="address_line_2" maxLength={200} defaultValue={tenant.address_line_2 ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Código postal" : "Postal code"}</span><input name="postal_code" maxLength={20} defaultValue={tenant.postal_code ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Ciudad" : "City"}</span><input name="city" maxLength={100} defaultValue={tenant.city ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "Provincia" : "Province"}</span><input name="province" maxLength={100} defaultValue={tenant.province ?? ""} className={input} /></label>
          <label><span className={label}>{es ? "País" : "Country"}</span><input name="country" maxLength={100} defaultValue={tenant.country ?? ""} className={input} /></label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3"><button disabled={companyPending} className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{companyPending ? (es ? "Guardando..." : "Saving...") : (es ? "Guardar empresa" : "Save company details")}</button>{companyResult?.ok && <span className="text-xs font-semibold text-sage">{es ? "Guardado." : "Saved."}</span>}{companyResult && !companyResult.ok && <span className="text-xs font-semibold text-danger">{companyResult.error}</span>}</div>
        </form>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">{es ? "Cuenta bancaria" : "Bank account"}</h2>
        <p className="mb-4 mt-1 text-xs text-taupe">{es ? "Esta cuenta se utilizará para los pagos de SoftLife." : "This account will be used for SoftLife payouts."}</p>
        <form action={bankAction} className="grid gap-3 sm:grid-cols-2">
          <label><span className={label}>{es ? "Titular de la cuenta" : "Account holder"}</span><input name="account_holder_name" required maxLength={150} autoComplete="name" defaultValue={bank?.account_holder_name ?? ""} className={input} /></label>
          <label><span className={label}>IBAN</span><input name="iban" required maxLength={34} autoComplete="off" spellCheck={false} defaultValue={bank?.iban ?? ""} className={`${input} font-mono uppercase`} /></label>
          <label><span className={label}>BIC / SWIFT</span><input name="bic_swift" maxLength={11} autoComplete="off" defaultValue={bank?.bic_swift ?? ""} className={`${input} font-mono uppercase`} /></label>
          <label><span className={label}>{es ? "Banco" : "Bank name"}</span><input name="bank_name" maxLength={150} defaultValue={bank?.bank_name ?? ""} className={input} /></label>
          <div className="flex items-center gap-3 sm:col-span-2"><button disabled={bankPending} className="rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{bankPending ? (es ? "Guardando..." : "Saving...") : (es ? "Guardar cuenta" : "Save bank account")}</button>{bankResult?.ok && <span className="text-xs font-semibold text-sage">{es ? "Guardado." : "Saved."}</span>}{bankResult && !bankResult.ok && <span className="text-xs font-semibold text-danger">{bankResult.error}</span>}</div>
        </form>
      </section>
    </div>
  );
}
