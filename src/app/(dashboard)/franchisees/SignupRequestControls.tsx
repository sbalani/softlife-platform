"use client";

import { useActionState, useTransition } from "react";
import { approveFranchiseeSignup, rejectFranchiseeSignup, type TenantResult } from "./actions";

export function SignupRequestControls({ requestId, tenants }: { requestId: string; tenants: { id: string; name: string }[] }) {
  const [result, action, pending] = useActionState<TenantResult | null, FormData>(approveFranchiseeSignup, null);
  const [rejecting, startTransition] = useTransition();
  return (
    <form action={action} className="flex min-w-[300px] flex-wrap items-end gap-2">
      <input type="hidden" name="request_id" value={requestId} />
      <label className="flex-1"><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">Assign privately</span><select name="tenant_id" required defaultValue="" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-cocoa"><option value="" disabled>Select franchisee</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
      <button disabled={pending || rejecting} className="rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Approving..." : "Approve & invite"}</button>
      <button type="button" disabled={pending || rejecting} onClick={() => startTransition(async () => { await rejectFranchiseeSignup(requestId); })} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-danger disabled:opacity-50">Reject</button>
      {result?.ok && <span className="basis-full text-xs font-semibold text-sage">Access assigned and invitation sent.</span>}
      {result && !result.ok && <span className="basis-full text-xs font-semibold text-danger">{result.error}</span>}
    </form>
  );
}
