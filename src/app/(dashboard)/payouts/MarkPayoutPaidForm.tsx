"use client";

import { useActionState } from "react";
import { markPayoutPaid, type MarkPayoutState } from "./actions";

export function MarkPayoutPaidForm({ tenantId, month }: { tenantId: string; month: string }) {
  const [state, action, pending] = useActionState<MarkPayoutState, FormData>(markPayoutPaid, null);
  return (
    <form action={action} className="min-w-56 space-y-2 rounded-xl border border-line bg-cream/50 p-3">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="month" value={month} />
      <label className="block text-[11px] font-bold uppercase tracking-wide text-taupe">Transfer reference<input name="payment_reference" required maxLength={200} placeholder="Bank reference" className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-cocoa" /></label>
      <label className="flex items-start gap-2 text-[11px] leading-4 text-cocoa">
        <input type="checkbox" name="confirmed" value="yes" required className="mt-0.5 accent-terracotta" />
        <span>I confirm the transfer is complete and agreement acceptance has been verified.</span>
      </label>
      <button disabled={pending} className="w-full rounded-lg bg-sage px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {pending ? "Saving..." : "Mark as paid"}
      </button>
      {state && <p role="status" className={`text-[11px] font-semibold ${state.ok ? "text-sage" : "text-danger"}`}>{state.message}</p>}
    </form>
  );
}
