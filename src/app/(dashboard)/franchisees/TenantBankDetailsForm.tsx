"use client";

import { useActionState } from "react";
import type { TenantBankDetails } from "@/lib/data/franchisees";
import { updateTenantBankDetails, type TenantResult } from "./actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe";

export function TenantBankDetailsForm({ tenantId, bank }: { tenantId: string; bank: TenantBankDetails | null }) {
  const [result, action, pending] = useActionState<TenantResult | null, FormData>(updateTenantBankDetails, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <label><span className={label}>Account holder</span><input name="account_holder_name" required maxLength={150} defaultValue={bank?.account_holder_name ?? ""} className={input} /></label>
      <label><span className={label}>IBAN</span><input name="iban" required maxLength={34} spellCheck={false} defaultValue={bank?.iban ?? ""} className={`${input} font-mono uppercase`} /></label>
      <label><span className={label}>BIC / SWIFT</span><input name="bic_swift" maxLength={11} defaultValue={bank?.bic_swift ?? ""} className={`${input} font-mono uppercase`} /></label>
      <label><span className={label}>Bank name</span><input name="bank_name" maxLength={150} defaultValue={bank?.bank_name ?? ""} className={input} /></label>
      <div className="flex items-center gap-3 sm:col-span-2"><button disabled={pending} className="rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Saving..." : "Save bank details"}</button>{result?.ok && <span className="text-xs font-semibold text-sage">Saved.</span>}{result && !result.ok && <span className="text-xs font-semibold text-danger">{result.error}</span>}</div>
    </form>
  );
}
