"use client";

import { useState } from "react";

type DataPoint = { label: string; value: number };

export function LineChart({
  data,
  color = "#d47e54",
  height = 200,
  unit = "€",
}: {
  data: DataPoint[];
  color?: string;
  height?: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!data.length) {
    return <div className="flex items-center justify-center text-sm text-taupe" style={{ height }}>No data</div>;
  }

  const W = 600;
  const H = height;
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const max = Math.max(...data.map((d) => d.value), 1);
  const niceMax = Math.ceil(max * 1.15) || 1;
  const step = chartW / Math.max(data.length - 1, 1);

  const pts = data.map((d, i) => ({
    x: padL + i * step,
    y: padT + chartH - (d.value / niceMax) * chartH,
    label: d.label,
    value: d.value,
  }));

  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${padT + chartH} L${pts[0].x.toFixed(1)},${padT + chartH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + chartH - f * chartH,
    val: f * niceMax,
  }));

  const xStride = Math.ceil(data.length / 8);
  const fmtVal = (v: number) => unit === "€" ? `€${v.toFixed(2)}` : `${v}${unit}`;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid + Y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#e6e0da" strokeWidth={1} />
            <text x={padL - 6} y={t.y + 3} textAnchor="end" fontSize={10} fill="#927c6c">
              {unit === "€" ? `€${t.val.toFixed(0)}` : t.val.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Area */}
        <path d={areaPath} fill={color} opacity={0.12} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Hover line */}
        {hover !== null && (
          <line x1={pts[hover].x} y1={padT} x2={pts[hover].x} y2={padT + chartH} stroke={color} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        )}

        {/* Points */}
        {pts.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 6 : 4}
              fill={hover === i ? color : "#fff"}
              stroke={color}
              strokeWidth={2}
              className="cursor-pointer transition-all"
              onMouseEnter={() => setHover(i)}
            />
          </g>
        ))}

        {/* X labels */}
        {pts.map((p, i) =>
          i % xStride === 0 || i === pts.length - 1 ? (
            <text key={i} x={p.x} y={H - padB + 14} textAnchor="middle" fontSize={9} fill="#927c6c">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>

      {/* Tooltip */}
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-white px-3 py-1.5 shadow-lg"
          style={{
            left: `${(pts[hover].x / W) * 100}%`,
            top: 0,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-[10px] uppercase tracking-wide text-taupe">{pts[hover].label}</div>
          <div className="text-sm font-bold text-cocoa">{fmtVal(pts[hover].value)}</div>
        </div>
      )}
    </div>
  );
}
