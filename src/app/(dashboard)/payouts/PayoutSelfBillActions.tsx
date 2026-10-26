"use client";

import { useActionState } from "react";
import { createPayoutSelfBill, postPayoutSelfBill, retryPayoutSelfBill, type PayoutActionState } from "./actions";

export function CreatePayoutSelfBillForm({ tenantId, month }: { tenantId: string; month: string }) {
  const [state, action, pending] = useActionState<PayoutActionState, FormData>(createPayoutSelfBill, null);
  return (
    <form action={action} className="min-w-48 space-y-2 rounded-xl border border-line bg-cream/50 p-3">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="month" value={month} />
      <label className="flex items-start gap-2 text-[11px] leading-4 text-cocoa">
        <input type="checkbox" name="draft_only" value="yes" defaultChecked className="mt-0.5 accent-terracotta" />
        <span>Create as draft only</span>
      </label>
      <button disabled={pending} className="w-full rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {pending ? "Creating..." : "Create self-bill"}
      </button>
      {state && <p role="status" className={`text-[11px] font-semibold ${state.ok ? "text-sage" : "text-danger"}`}>{state.message}</p>}
    </form>
  );
}

export function PostPayoutSelfBillForm({ selfBillId }: { selfBillId: string }) {
  const [state, action, pending] = useActionState<PayoutActionState, FormData>(postPayoutSelfBill, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="self_bill_id" value={selfBillId} />
      <button disabled={pending} className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {pending ? "Queuing..." : "Post self-bill"}
      </button>
      {state && <p role="status" className={`max-w-48 text-[11px] font-semibold ${state.ok ? "text-sage" : "text-danger"}`}>{state.message}</p>}
    </form>
  );
}

export function RetryPayoutSelfBillForm({ selfBillId }: { selfBillId: string }) {
  const [state, action, pending] = useActionState<PayoutActionState, FormData>(retryPayoutSelfBill, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="self_bill_id" value={selfBillId} />
      <button disabled={pending} className="rounded-lg border border-danger px-3 py-2 text-xs font-bold text-danger disabled:opacity-50">
        {pending ? "Retrying..." : "Retry exact request"}
      </button>
      {state && <p role="status" className={`max-w-48 text-[11px] font-semibold ${state.ok ? "text-sage" : "text-danger"}`}>{state.message}</p>}
    </form>
  );
}
