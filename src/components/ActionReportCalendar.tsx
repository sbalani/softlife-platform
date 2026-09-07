import Link from "next/link";
import { DEFAULT_TZ, ymd } from "@/lib/dates";
import type { ActionReportCalendarItem } from "@/lib/data/action-reports";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ActionReportCalendar({ month, previousMonth, nextMonth, today, selectedDay, reports }: {
  month: string;
  previousMonth: string;
  nextMonth: string;
  today: string;
  selectedDay: string | null;
  reports: ActionReportCalendarItem[];
}) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;
  const byDay = new Map<string, ActionReportCalendarItem[]>();
  for (const report of reports) {
    const day = ymd(new Date(report.occurredAt), DEFAULT_TZ);
    byDay.set(day, [...(byDay.get(day) ?? []), report]);
  }
  const label = first.toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-taupe">Service cadence</p>
          <h2 className="font-display text-lg font-bold text-cocoa">{label}</h2>
        </div>
        <div className="flex gap-2">
          <Link aria-label="Previous month" href={`/refills?month=${previousMonth}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-cocoa hover:bg-cream">←</Link>
          <Link aria-label="Next month" href={`/refills?month=${nextMonth}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-cocoa hover:bg-cream">→</Link>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-line bg-cream/60">
        {WEEKDAYS.map((day) => <div key={day} className="px-1 py-2 text-center text-[9px] font-bold uppercase tracking-wide text-taupe sm:text-[10px]">{day}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: leading }).map((_, index) => <div key={`blank-${index}`} className="min-h-20 border-r border-b border-line bg-cream/30 sm:min-h-28" />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = `${month}-${String(index + 1).padStart(2, "0")}`;
          const items = byDay.get(day) ?? [];
          const visibleItems = [...items.filter((item) => item.status === "draft"), ...items.filter((item) => item.status !== "draft").slice(0, 2)];
          const canCreate = day <= today;
          return (
            <div key={day} className={`min-h-20 border-r border-b border-line p-1 sm:min-h-28 sm:p-2 ${selectedDay === day ? "bg-terracotta/10 ring-1 ring-inset ring-terracotta" : ""}`}>
              {canCreate ? <Link title={`Create report for ${day}`} href={`/refills?month=${month}&date=${day}#action-report-form`} className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${day === today ? "bg-cocoa text-white" : "text-cocoa hover:bg-cream"}`}>{index + 1}</Link> : <span className="inline-flex size-6 items-center justify-center text-xs text-taupe/50">{index + 1}</span>}
              <div className="mt-1 space-y-1">
                {visibleItems.map((item) => {
                  const style = item.status === "draft" ? "bg-warning/15 text-warning" : item.status === "confirmed" ? "bg-sage/15 text-sage" : "bg-taupe/15 text-taupe";
                  const content = <><span className="sm:hidden">●</span><span className="hidden sm:inline">{item.machineName}</span></>;
                  return item.status === "draft"
                    ? <Link title={`${item.machineName}: resume draft`} href={`/refills?month=${month}&draft=${item.id}#action-report-form`} key={item.id} className={`block truncate rounded px-1 py-0.5 text-[9px] font-semibold sm:text-[10px] ${style}`}>{content}</Link>
                    : <span title={`${item.machineName}: ${item.actionKind} · ${item.status}`} key={item.id} className={`block truncate rounded px-1 py-0.5 text-[9px] font-semibold sm:text-[10px] ${style}`}>{content}</span>;
                })}
                {items.length > visibleItems.length && <p className="text-[9px] font-semibold text-taupe">+{items.length - visibleItems.length} more</p>}
              </div>
            </div>
          );
        })}
        {Array.from({ length: trailing }).map((_, index) => <div key={`trailing-${index}`} className="min-h-20 border-r border-b border-line bg-cream/30 sm:min-h-28" />)}
      </div>
      <p className="px-4 py-3 text-xs text-taupe">Select a past or current day to start a report. Green entries are confirmed, amber entries are drafts, and grey entries are voided.</p>
    </section>
  );
}
