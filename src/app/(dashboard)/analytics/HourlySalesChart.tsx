"use client";

import { useState } from "react";
import { ANALYTICS_WEEKDAYS, type HourlySalesRow } from "@/lib/analytics";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function HourlySalesChart({ rows, weekdayOccurrences, timeZone }: {
  rows: HourlySalesRow[];
  weekdayOccurrences: number[];
  timeZone: string;
}) {
  const [selectedDay, setSelectedDay] = useState("all");
  const [hover, setHover] = useState<number | null>(null);
  const selectedIndex = selectedDay === "all" ? -1 : Number(selectedDay);
  const selectedAvailable = selectedIndex >= 0 && weekdayOccurrences[selectedIndex] > 0;
  const selectedValues = selectedAvailable ? rows.map((row) => row.weekdayAverages[selectedIndex]) : [];
  const allValues = rows.map((row) => row.allDaysAverage);
  const width = 720;
  const height = 300;
  const pad = { left: 58, right: 22, top: 24, bottom: 42 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const max = Math.max(...allValues, ...selectedValues, 1) * 1.15;
  const x = (index: number) => pad.left + (index / 23) * chartWidth;
  const y = (value: number) => pad.top + chartHeight - (value / max) * chartHeight;
  const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const pointerIndex = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = (event.clientX - bounds.left) / bounds.width * width;
    return Math.max(0, Math.min(23, Math.round(((pointerX - pad.left) / chartWidth) * 23)));
  };

  return (
    <section className="mt-6 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-lg font-bold text-cocoa">Average sales by hour</h2><p className="mt-1 text-xs text-taupe">Average net sales per local hour, including zero-sales days · {timeZone}</p></div>
        <label className="text-xs text-taupe"><span className="mb-1 block uppercase tracking-wide">Compare weekday</span><select value={selectedDay} onChange={(event) => { setSelectedDay(event.target.value); setHover(null); }} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-cocoa focus:border-terracotta focus:outline-none"><option value="all">All days only</option>{WEEKDAY_NAMES.map((name, index) => <option key={name} value={index} disabled={weekdayOccurrences[index] === 0}>{name}{weekdayOccurrences[index] === 0 ? " (outside range)" : ""}</option>)}</select></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs font-semibold text-taupe"><span className="flex items-center gap-2"><i className="h-0.5 w-6 bg-terracotta" />All-days average</span>{selectedAvailable && <span className="flex items-center gap-2"><i className="h-0.5 w-6 bg-sage" />{WEEKDAY_NAMES[selectedIndex]} average · {weekdayOccurrences[selectedIndex]} day{weekdayOccurrences[selectedIndex] === 1 ? "" : "s"}</span>}</div>
      <div className="mt-2 overflow-x-auto"><div className="relative min-w-[720px]">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} onPointerMove={(event) => setHover(pointerIndex(event))} onPointerLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => { const tickY = pad.top + chartHeight - fraction * chartHeight; return <g key={fraction}><line x1={pad.left} y1={tickY} x2={width - pad.right} y2={tickY} stroke="#e6e0da" /><text x={pad.left - 8} y={tickY + 4} textAnchor="end" fontSize="10" fill="#927c6c">€{(max * fraction).toFixed(0)}</text></g>; })}
          {rows.map((row, index) => index % 3 === 0 || index === 23 ? <text key={row.hour} x={x(index)} y={height - 14} textAnchor="middle" fontSize="10" fill="#927c6c">{String(row.hour).padStart(2, "0")}:00</text> : null)}
          <path d={path(allValues)} fill="none" stroke="#d47e54" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {selectedAvailable && <path d={path(selectedValues)} fill="none" stroke="#6fa98c" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
          {hover !== null && <><line x1={x(hover)} y1={pad.top} x2={x(hover)} y2={pad.top + chartHeight} stroke="#927c6c" strokeDasharray="4 4" /><circle cx={x(hover)} cy={y(allValues[hover])} r="5" fill="white" stroke="#d47e54" strokeWidth="3" />{selectedAvailable && <circle cx={x(hover)} cy={y(selectedValues[hover])} r="5" fill="white" stroke="#6fa98c" strokeWidth="3" />}</>}
        </svg>
        {hover !== null && <div className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-white px-3 py-2 shadow-lg" style={{ left: `${(x(hover) / width) * 100}%`, transform: hover > 18 ? "translateX(-100%)" : hover < 5 ? "none" : "translateX(-50%)" }}><div className="text-[10px] font-bold uppercase text-taupe">{String(hover).padStart(2, "0")}:00</div><div className="mt-1 text-sm font-bold text-terracotta">All days €{allValues[hover].toFixed(2)}</div>{selectedAvailable && <><div className="text-sm font-bold text-sage">{ANALYTICS_WEEKDAYS[selectedIndex]} €{selectedValues[hover].toFixed(2)}</div><div className="text-xs text-taupe">Difference {(selectedValues[hover] - allValues[hover]) >= 0 ? "+" : ""}€{(selectedValues[hover] - allValues[hover]).toFixed(2)}</div></>}</div>}
      </div></div>
    </section>
  );
}
