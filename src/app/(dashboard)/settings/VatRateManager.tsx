"use client";

import { useActionState } from "react";
import type { VatRate } from "@/lib/data/franchisee-profit";
import { saveVatRate, type VatResult } from "./vat-actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";

export function VatRateManager({ rates }: { rates: VatRate[] }) {
  const [result, action, pending] = useActionState<VatResult | null, FormData>(saveVatRate, null);
  const today = new Date().toISOString().slice(0, 10);
  const current = [...rates].reverse().find((rate) => rate.effective_from <= today);

  return (
    <div className="space-y-4">
      <p className="text-sm text-taupe">Current VAT: <span className="font-bold text-cocoa">{current?.rate_percent ?? 10}%</span>. Future-dated rates apply automatically to sales on or after their effective date.</p>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">VAT rate %</span><input name="rate_percent" type="number" min="0" max="100" step="0.01" required defaultValue="10" className={input} /></label>
        <label><span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Effective from</span><input name="effective_from" type="date" required defaultValue={today} className={input} /></label>
        <button disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{pending ? "Saving…" : "Schedule VAT rate"}</button>
        {result && <span className={`text-xs ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Saved." : result.error}</span>}
      </form>
      {rates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rates.map((rate) => <span key={rate.id} className={`rounded-full px-3 py-1 text-xs ${rate.effective_from <= today ? "bg-sage/10 text-sage" : "bg-cream text-taupe"}`}>{rate.effective_from}: {rate.rate_percent}%</span>)}
        </div>
      )}
    </div>
  );
}
