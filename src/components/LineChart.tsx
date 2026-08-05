"use client";

import { useState } from "react";

type DataPoint = { label: string; value: number };

export function LineChart({
  data,
  color = "#d47e54",
  height = 200,
  unit = "€",
  zoomable = false,
  dynamicScale = false,
}: {
  data: DataPoint[];
  color?: string;
  height?: number;
  unit?: string;
  zoomable?: boolean;
  dynamicScale?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);

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
  const zoomStart = Math.min(zoom?.start ?? 0, data.length - 1);
  const zoomEnd = Math.min(zoom?.end ?? data.length - 1, data.length - 1);
  const visibleData = data.slice(zoomStart, zoomEnd + 1);

  const dataMin = Math.min(...visibleData.map((d) => d.value));
  const dataMax = Math.max(...visibleData.map((d) => d.value));
  const padding = Math.max((dataMax - dataMin) * 0.15, dynamicScale ? 0.5 : 0);
  const min = dynamicScale ? Math.floor((dataMin - padding) * 10) / 10 : Math.min(0, Math.floor(dataMin));
  const max = dynamicScale ? Math.ceil((dataMax + padding) * 10) / 10 : Math.max(0, Math.ceil(dataMax * 1.15));
  const range = Math.max(max - min, 1);
  const step = chartW / Math.max(visibleData.length - 1, 1);

  const pts = visibleData.map((d, i) => ({
    x: padL + i * step,
    y: padT + chartH - ((d.value - min) / range) * chartH,
    label: d.label,
    value: d.value,
  }));

  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${padT + chartH} L${pts[0].x.toFixed(1)},${padT + chartH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + chartH - f * chartH,
    val: min + f * range,
  }));

  const xStride = Math.ceil(visibleData.length / 8);
  const fmtVal = (v: number) => unit === "€" ? `€${v.toFixed(2)}` : `${v}${unit}`;
  const pointerIndex = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * W;
    return Math.max(0, Math.min(visibleData.length - 1, Math.round((x - padL) / Math.max(step, 1))));
  };
  const finishSelection = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!selection) return;
    const end = pointerIndex(event);
    const start = Math.min(selection.start, end);
    const last = Math.max(selection.start, end);
    setSelection(null);
    if (last > start) {
      setZoom({ start: zoomStart + start, end: zoomStart + last });
      setHover(null);
    }
  };

  return (
    <div className="relative w-full">
      {zoomable && (
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-taupe">
          <span>{zoom ? `${visibleData[0].label}–${visibleData[visibleData.length - 1].label}` : "Drag across the graph to zoom"}</span>
          {zoom && <button type="button" onClick={() => { setZoom(null); setHover(null); }} className="font-bold text-terracotta hover:underline">Reset zoom</button>}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height, touchAction: zoomable ? "none" : undefined }}
        onMouseLeave={() => setHover(null)}
        onPointerDown={zoomable ? (event) => { event.currentTarget.setPointerCapture(event.pointerId); const index = pointerIndex(event); setSelection({ start: index, end: index }); } : undefined}
        onPointerMove={zoomable && selection ? (event) => setSelection((current) => current ? { ...current, end: pointerIndex(event) } : null) : undefined}
        onPointerUp={zoomable ? finishSelection : undefined}
        onPointerCancel={() => setSelection(null)}
      >
        {/* Grid + Y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#e6e0da" strokeWidth={1} />
            <text x={padL - 6} y={t.y + 3} textAnchor="end" fontSize={10} fill="#927c6c">
              {unit === "€" ? `€${t.val.toFixed(0)}` : `${t.val.toFixed(range < 10 ? 1 : 0)}${unit}`}
            </text>
          </g>
        ))}

        {/* Area */}
        <path d={areaPath} fill={color} opacity={0.12} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {selection && (
          <rect
            x={padL + Math.min(selection.start, selection.end) * step}
            y={padT}
            width={Math.max(Math.abs(selection.end - selection.start) * step, 2)}
            height={chartH}
            fill={color}
            opacity={0.15}
          />
        )}

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
