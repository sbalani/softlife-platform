"use client";

import { useState } from "react";

type Franchisee = { tenantId: string; tenantName: string; total: number };

export function PayoutBulkExport({ franchisees, from, to }: { franchisees: Franchisee[]; from: string; to: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (tenantId: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(tenantId)) next.delete(tenantId); else next.add(tenantId);
    return next;
  });
  return <form action="/analytics/payout/export/bulk" method="post" className="mb-4 rounded-xl border border-line bg-cream/50 p-3">
    <input type="hidden" name="dateFrom" value={from} />
    <input type="hidden" name="dateTo" value={to} />
    {[...selected].map((tenantId) => <input key={tenantId} type="hidden" name="tenantId" value={tenantId} />)}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-xs font-bold text-cocoa">Bulk payout statements</p><p className="text-[11px] text-taupe">One PDF per positive payout, delivered in a ZIP archive.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSelected(new Set(franchisees.map((row) => row.tenantId)))} className="rounded border border-line bg-white px-2.5 py-1.5 text-xs font-bold text-cocoa">Select all</button><button type="button" onClick={() => setSelected(new Set())} className="px-2.5 py-1.5 text-xs font-bold text-terracotta">Clear</button></div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">{franchisees.map((franchisee) => <label key={franchisee.tenantId} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${selected.has(franchisee.tenantId) ? "border-sage bg-sage/10 text-cocoa" : "border-line bg-white text-taupe"}`}><input type="checkbox" checked={selected.has(franchisee.tenantId)} onChange={() => toggle(franchisee.tenantId)} className="accent-sage" />{franchisee.tenantName} · €{franchisee.total.toFixed(2)}</label>)}</div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-taupe"><input type="checkbox" name="includeBankDetails" value="true" className="accent-terracotta" />Include bank details when available</label>
      <button name="mode" value="selected" disabled={!selected.size} className="rounded bg-cocoa px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Download selected ({selected.size})</button>
      <button name="mode" value="all" className="rounded bg-sage px-3 py-2 text-xs font-bold text-white">Download all positive ({franchisees.length})</button>
    </div>
  </form>;
}
