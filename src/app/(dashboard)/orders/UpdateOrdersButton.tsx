"use client";

import { useActionState } from "react";
import { updateOrders, type UpdateOrdersResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";

export function UpdateOrdersButton() {
  const [res, action, pending] = useActionState<UpdateOrdersResult | null, FormData>(updateOrders, null);

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {res && (
          <span className={`text-xs font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>{res.summary}</span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Updating…" : "↻ Update orders"}
        </button>
      </div>
      <details className="text-right">
        <summary className="cursor-pointer text-[11px] font-semibold text-taupe hover:text-terracotta">
          Advanced: custom date range
        </summary>
        <div className="mt-2 flex flex-wrap items-end justify-end gap-2">
          <label className="block text-left">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">From</span>
            <input name="from" type="date" className={input} />
          </label>
          <label className="block text-left">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">To</span>
            <input name="to" type="date" className={input} />
          </label>
        </div>
        <p className="mt-1 text-[10px] text-taupe">
          Default is the last 7 days. Set a range to backfill after a gap (max 92 days per run).
        </p>
      </details>
    </form>
  );
}
