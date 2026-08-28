"use client";

import { useState } from "react";
import { ANALYTICS_WEEKDAYS, type HourlySalesRow } from "@/lib/analytics";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function money(value: number) {
  return `€${value.toFixed(2)}`;
}

export function HourlySalesTable({ rows, weekdayOccurrences, timeZone }: {
  rows: HourlySalesRow[];
  weekdayOccurrences: number[];
  timeZone: string;
}) {
  const [selectedDay, setSelectedDay] = useState("all");
  const selectedIndex = selectedDay === "all" ? -1 : Number(selectedDay);
  const selectedName = selectedIndex >= 0 ? WEEKDAY_NAMES[selectedIndex] : null;
  const selectedAvailable = selectedIndex >= 0 && weekdayOccurrences[selectedIndex] > 0;

  return (
    <section className="mt-6 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-cocoa">Average sales by hour</h2>
          <p className="mt-1 text-xs text-taupe">Average net sales per local hour, including zero-sales days · {timeZone}</p>
        </div>
        <label className="text-xs text-taupe">
          <span className="mb-1 block uppercase tracking-wide">Day shown</span>
          <select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-cocoa focus:border-terracotta focus:outline-none">
            <option value="all">All days</option>
            {WEEKDAY_NAMES.map((name, index) => <option key={name} value={index} disabled={weekdayOccurrences[index] === 0}>{name}{weekdayOccurrences[index] === 0 ? " (outside range)" : ""}</option>)}
          </select>
        </label>
      </div>

      {selectedIndex >= 0 && weekdayOccurrences[selectedIndex] === 0 && (
        <p className="mt-4 rounded-lg bg-cream/60 px-3 py-2 text-xs text-warning">No {selectedName}s occur in the selected date range.</p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-[11px] uppercase text-taupe">
            <tr>
              <th className="sticky left-0 bg-white py-2 pr-3">Local hour</th>
              <th className="text-right">All days avg</th>
              {selectedIndex >= 0 && <th className="text-right">{ANALYTICS_WEEKDAYS[selectedIndex]} avg ({weekdayOccurrences[selectedIndex]} days)</th>}
              {selectedIndex >= 0 && <th className="text-right">Vs all days</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const selectedAverage = selectedAvailable ? row.weekdayAverages[selectedIndex] : null;
              const difference = selectedAverage === null ? null : selectedAverage - row.allDaysAverage;
              const percent = difference !== null && row.allDaysAverage ? (difference / row.allDaysAverage) * 100 : null;
              return (
                <tr key={row.hour}>
                  <td className="sticky left-0 bg-white py-2 pr-3 font-mono font-semibold text-cocoa">{String(row.hour).padStart(2, "0")}:00</td>
                  <td className="text-right font-semibold text-cocoa">{money(row.allDaysAverage)}</td>
                  {selectedIndex >= 0 && <td className="text-right font-bold text-cocoa">{selectedAverage === null ? "—" : money(selectedAverage)}</td>}
                  {selectedIndex >= 0 && (
                    <td className={`text-right font-semibold ${difference !== null && difference > 0 ? "text-sage" : difference !== null && difference < 0 ? "text-warning" : "text-taupe"}`}>
                      {difference === null ? "—" : <>{difference > 0 ? "+" : difference < 0 ? "-" : ""}{money(Math.abs(difference))}{percent === null ? difference ? " · no baseline" : "" : ` · ${percent >= 0 ? "+" : ""}${percent.toFixed(0)}%`}</>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
