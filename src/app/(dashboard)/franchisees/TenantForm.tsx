"use client";

import { useActionState } from "react";
import { createTenant, type TenantResult } from "./actions";

export function TenantForm() {
  const [res, action, pending] = useActionState<TenantResult | null, FormData>(createTenant, null);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Name</span>
        <input
          name="name"
          required
          placeholder="e.g. Cafetería Centro"
          maxLength={150}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none"
        />
      </label>
      <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Email *</span><input name="contact_email" type="email" required maxLength={254} className="w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
      <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Phone *</span><input name="contact_phone" required maxLength={40} inputMode="tel" className="w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
      <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Company / autónomo</span><input name="company_name" maxLength={150} className="w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
      <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">NIF / CIF</span><input name="tax_id" maxLength={50} className="w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
      <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Account holder</span><input name="account_holder_name" maxLength={150} className="w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
      <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">IBAN</span><input name="iban" maxLength={34} className="w-full rounded-lg border border-line px-3 py-2 font-mono text-sm uppercase" /></label>
      <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">BIC / SWIFT</span><input name="bic_swift" maxLength={11} className="w-full rounded-lg border border-line px-3 py-2 font-mono text-sm uppercase" /></label>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Kind</span>
        <select name="kind" className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa">
          <option value="franchisee">Franchisee</option>
          <option value="internal">Internal</option>
        </select>
      </label>
       <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add"}
      </button>
       {res && !res.ok && <span className="text-xs text-danger lg:col-span-3">{res.error}</span>}
    </form>
  );
}
