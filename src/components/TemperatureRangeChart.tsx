"use client";

import { useState } from "react";
import { finiteTemperaturePoints, temperatureTickIndexes, type TemperatureChartPoint } from "@/lib/temperature-chart";

export function TemperatureRangeChart({ data, height = 280 }: { data: TemperatureChartPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [tickCount, setTickCount] = useState(6);
  const points = finiteTemperaturePoints(data);
  if (!points.length) return <div className="flex items-center justify-center text-sm text-taupe" style={{ height }}>No finite data</div>;

  const width = 700;
  const pad = { left: 52, right: 18, top: 18, bottom: 52 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = Math.max(1, height - pad.top - pad.bottom);
  const low = Math.min(...points.map((point) => point.minimum));
  const high = Math.max(...points.map((point) => point.maximum));
  const padding = Math.max((high - low) * 0.12, 0.5);
  const minimum = Math.floor((low - padding) * 10) / 10;
  const maximum = Math.ceil((high + padding) * 10) / 10;
  const range = Math.max(maximum - minimum, 1);
  const step = chartWidth / Math.max(points.length - 1, 1);
  const x = (index: number) => pad.left + index * step;
  const y = (value: number) => pad.top + chartHeight - ((value - minimum) / range) * chartHeight;
  const averagePath = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const rangePath = `${points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.maximum).toFixed(1)}`).join(" ")} ${[...points].reverse().map((point, reverseIndex) => `L${x(points.length - 1 - reverseIndex).toFixed(1)},${y(point.minimum).toFixed(1)}`).join(" ")} Z`;
  const hovered = hover !== null && hover < points.length ? points[hover] : null;
  const ticks = temperatureTickIndexes(points.length, tickCount);

  return <div className="relative w-full">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-taupe">
      <span><span className="mr-1 inline-block h-2 w-5 rounded-sm bg-terracotta/20" />Minimum–maximum range <span className="ml-3 mr-1 inline-block h-0 w-5 border-t-2 border-terracotta" />Average</span>
      <label className="font-semibold">X-axis labels <select value={tickCount} onChange={(event) => setTickCount(Number(event.target.value))} className="ml-2 rounded border border-line bg-white px-2 py-1 text-cocoa"><option value={4}>4</option><option value={6}>6</option><option value={8}>8</option><option value={12}>12</option></select></label>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {[0, .25, .5, .75, 1].map((fraction) => { const value = minimum + fraction * range; const rowY = y(value); return <g key={fraction}><line x1={pad.left} y1={rowY} x2={width - pad.right} y2={rowY} stroke="#e6e0da" /><text x={pad.left - 7} y={rowY + 3} textAnchor="end" fontSize="10" fill="#927c6c">{value.toFixed(1)}°C</text></g>; })}
      <path d={rangePath} fill="#d47e54" opacity="0.18" />
      <path d={averagePath} fill="none" stroke="#d47e54" strokeWidth="2.5" strokeLinejoin="round" />
      {hovered && <line x1={x(hover!)} y1={pad.top} x2={x(hover!)} y2={pad.top + chartHeight} stroke="#d47e54" strokeDasharray="4 4" />}
      {points.map((point, index) => <rect key={`${point.label}-${index}`} x={x(index) - Math.max(step / 2, 5)} y={pad.top} width={Math.max(step, 10)} height={chartHeight} fill="transparent" onMouseEnter={() => setHover(index)} onPointerDown={() => setHover(index)} />)}
      {ticks.map((index) => <text key={index} x={x(index)} y={height - 26} textAnchor="middle" fontSize="9" fill="#927c6c">{points[index].label}</text>)}
    </svg>
    {hovered && <div className="pointer-events-none absolute top-10 z-10 rounded-lg border border-line bg-white px-3 py-2 shadow-lg" style={{ left: `${x(hover!) / width * 100}%`, transform: "translateX(-50%)" }}><div className="text-[10px] uppercase tracking-wide text-taupe">{hovered.label}</div><div className="font-bold text-cocoa">Average {hovered.value.toFixed(2)}°C</div><div className="text-xs text-taupe">Range {hovered.minimum.toFixed(2)}–{hovered.maximum.toFixed(2)}°C</div></div>}
  </div>;
}
