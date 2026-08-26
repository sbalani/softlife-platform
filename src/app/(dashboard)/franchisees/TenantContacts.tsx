"use client";

import { useActionState, useTransition } from "react";
import type { TenantContact } from "@/lib/data/franchisees";
import { addTenantContact, removeTenantContact, type TenantResult } from "./actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe";

export function TenantContacts({ tenantId, contacts }: { tenantId: string; contacts: TenantContact[] }) {
  const [result, action, pending] = useActionState<TenantResult | null, FormData>(addTenantContact, null);
  const [removing, startTransition] = useTransition();
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wide text-taupe">Contact people</h4>
      <div className="mt-2 space-y-2">
        {contacts.map((contact) => (
          <div key={contact.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-cream/40 px-3 py-2 text-xs">
            <div><span className="font-bold text-cocoa">{contact.full_name}</span>{contact.job_title && <span className="text-taupe"> · {contact.job_title}</span>}{contact.is_primary && <span className="ml-2 rounded-full bg-sage/15 px-2 py-0.5 font-bold text-sage">Primary</span>}<div className="mt-1 flex flex-wrap gap-3 text-taupe">{contact.email && <a href={`mailto:${contact.email}`} className="hover:text-terracotta">{contact.email}</a>}{contact.phone && <a href={`tel:${contact.phone}`} className="hover:text-terracotta">{contact.phone}</a>}</div></div>
            <button type="button" disabled={removing} onClick={() => startTransition(async () => { await removeTenantContact(contact.id); })} className="font-bold text-danger disabled:opacity-50">Remove</button>
          </div>
        ))}
        {!contacts.length && <p className="text-xs text-taupe">No contact people added.</p>}
      </div>
      <form action={action} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <label><span className={label}>Name *</span><input name="full_name" required maxLength={150} className={input} /></label>
        <label><span className={label}>Role / title</span><input name="job_title" maxLength={150} className={input} /></label>
        <label><span className={label}>Email</span><input name="email" type="email" maxLength={254} className={input} /></label>
        <label><span className={label}>Phone</span><input name="phone" maxLength={40} inputMode="tel" className={input} /></label>
        <div className="flex items-end gap-2 pb-0.5"><label className="flex items-center gap-1.5 text-xs text-cocoa"><input type="checkbox" name="is_primary" value="yes" />Primary</label><button disabled={pending} className="ml-auto rounded bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Adding..." : "Add"}</button></div>
        {result && !result.ok && <p className="text-xs font-semibold text-danger sm:col-span-2 lg:col-span-5">{result.error}</p>}
      </form>
    </div>
  );
}
