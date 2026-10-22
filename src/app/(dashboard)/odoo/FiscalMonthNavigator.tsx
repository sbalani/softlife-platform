"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { FiscalCalendarSpan } from "@/lib/odoo-fiscal-invoices";

type FiscalCalendar = {
  cells: Array<{ date: string; spans: FiscalCalendarSpan[] } | null>;
  clippedSpans: Array<FiscalCalendarSpan & { visible_from: string; visible_to: string }>;
};

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function statusStyle(status: string) {
  if (["ready", "eligible", "draft", "draft_ready", "completed", "posted"].includes(status)) return "bg-sage/15 text-sage";
  if (["excluded", "queued", "draft_pending", "confirmation_pending"].includes(status)) return "bg-taupe/10 text-taupe";
  return "bg-danger/10 text-danger";
}

export function FiscalMonthNavigator({ month, calendar, selectedRunId }: {
  month: string;
  calendar: FiscalCalendar;
  selectedRunId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function selectMonth(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value === month) return;
    const params = new URLSearchParams({ fiscal_month: value });
    if (selectedRunId) params.set("fiscal_run", selectedRunId);
    startTransition(() => router.replace(`/odoo?${params}`, { scroll: false }));
  }

  return <section className={`mb-8 rounded-2xl border border-line bg-white p-5 transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-terracotta">Shared reporting period</p>
        <h2 className="font-display text-xl font-bold text-cocoa">Fiscal workspace month</h2>
        <p className="mt-1 max-w-3xl text-xs text-taupe">Controls preflight date defaults, invoice execution history, and invoice-to-sales-order reconciliation.</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => selectMonth(shiftMonth(month, -1))} disabled={pending} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-cocoa disabled:opacity-50">Previous</button>
        <label className="text-xs font-semibold text-taupe"><span className="sr-only">Fiscal workspace month</span><input type="month" value={month} onChange={(event) => selectMonth(event.target.value)} disabled={pending} className="rounded-lg border border-line px-3 py-2 font-bold text-cocoa disabled:opacity-50" /></label>
        <button type="button" onClick={() => selectMonth(shiftMonth(month, 1))} disabled={pending} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-cocoa disabled:opacity-50">Next</button>
      </div>
    </div>
    <details className="mt-4 rounded-xl border border-line">
      <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-cocoa">Processed invoice calendar · {new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</summary>
      <div className="border-t border-line p-3">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line text-center text-[10px]"><>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="bg-sand px-1 py-1.5 font-bold uppercase text-taupe">{day}</div>)}</>{calendar.cells.map((cell, index) => <div key={cell?.date ?? `blank-${index}`} className="min-h-16 bg-white p-1 text-left"><span className="text-taupe">{cell?.date.slice(-2)}</span>{cell?.spans.map((span) => <div key={span.id} title={`${span.local_date_from} through ${span.local_date_to} · ${span.status}`} className={`mt-1 truncate rounded px-1 py-0.5 font-semibold ${statusStyle(span.status)}`}>{span.local_date_from === cell.date ? `${span.local_date_from} → ${span.local_date_to}` : span.status}</div>)}</div>)}</div>
        {calendar.clippedSpans.length > 0 && <p className="mt-2 text-[10px] text-taupe">Visible processed ranges: {calendar.clippedSpans.map((span) => `${span.visible_from} through ${span.visible_to} (${span.status})`).join(" · ")}</p>}
      </div>
    </details>
    {pending && <p className="mt-2 text-xs font-semibold text-terracotta" role="status">Updating month data…</p>}
  </section>;
}
