"use client";

import { useActionState } from "react";
import type { Tenant } from "@/lib/data/franchisees";
import { updateTenantDetails, type TenantResult } from "./actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe";

export function TenantDetailsForm({ tenant }: { tenant: Tenant }) {
  const [result, action, pending] = useActionState<TenantResult | null, FormData>(updateTenantDetails, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="tenant_id" value={tenant.id} />
      <label><span className={label}>Registered company</span><input name="company_name" maxLength={150} defaultValue={tenant.company_name ?? ""} className={input} /></label>
      <label><span className={label}>Tax ID / NIF / CIF</span><input name="tax_id" maxLength={50} defaultValue={tenant.tax_id ?? ""} className={input} /></label>
      <label><span className={label}>Company email</span><input name="contact_email" type="email" maxLength={254} defaultValue={tenant.contact_email ?? ""} className={input} /></label>
      <label><span className={label}>Company phone</span><input name="contact_phone" maxLength={40} inputMode="tel" defaultValue={tenant.contact_phone ?? ""} className={input} /></label>
      <label><span className={label}>Website</span><input name="website" type="url" maxLength={300} placeholder="https://" defaultValue={tenant.website ?? ""} className={input} /></label>
      <label><span className={label}>Address</span><input name="address_line_1" maxLength={200} defaultValue={tenant.address_line_1 ?? ""} className={input} /></label>
      <label><span className={label}>Address line 2</span><input name="address_line_2" maxLength={200} defaultValue={tenant.address_line_2 ?? ""} className={input} /></label>
      <label><span className={label}>Postal code</span><input name="postal_code" maxLength={20} defaultValue={tenant.postal_code ?? ""} className={input} /></label>
      <label><span className={label}>City</span><input name="city" maxLength={100} defaultValue={tenant.city ?? ""} className={input} /></label>
      <label><span className={label}>Province</span><input name="province" maxLength={100} defaultValue={tenant.province ?? ""} className={input} /></label>
      <label><span className={label}>Country</span><input name="country" maxLength={100} defaultValue={tenant.country ?? ""} className={input} /></label>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
        <button disabled={pending} className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Saving..." : "Save company details"}</button>
        {result?.ok && <span className="text-xs font-semibold text-sage">Saved.</span>}
        {result && !result.ok && <span className="text-xs font-semibold text-danger">{result.error}</span>}
      </div>
    </form>
  );
}
