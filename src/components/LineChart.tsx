"use client";

import { useState } from "react";

type DataPoint = { day?: string; label: string; value: number };
type WeatherPoint = DataPoint & { minimum: number; maximum: number; precipitation: number; condition: string };
type ChartAnnotation = { id: string; day: string; text: string; category: string; machineName?: string | null };

export function LineChart({
  data,
  color = "#d47e54",
  height = 200,
  unit = "€",
  zoomable = false,
  dynamicScale = false,
  secondaryData,
  secondaryColor = "#b65d5d",
  secondaryUnit = "",
  secondaryLabel = "Incidents",
  weatherData,
  weatherLabel = "Mean temperature",
  weatherUnit = "°C",
  annotations = [],
}: {
  data: DataPoint[];
  color?: string;
  height?: number;
  unit?: string;
  zoomable?: boolean;
  dynamicScale?: boolean;
  secondaryData?: DataPoint[];
  secondaryColor?: string;
  secondaryUnit?: string;
  secondaryLabel?: string;
  weatherData?: WeatherPoint[];
  weatherLabel?: string;
  weatherUnit?: string;
  annotations?: ChartAnnotation[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [showWeather, setShowWeather] = useState(true);
  const [showNotes, setShowNotes] = useState(true);

  if (!data.length) {
    return <div className="flex items-center justify-center text-sm text-taupe" style={{ height }}>No data</div>;
  }

  const W = 600;
  const H = height;
  const padL = 50;
  const hasWeather = showWeather && !!weatherData?.length;
  const padR = secondaryData || hasWeather ? 50 : 20;
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
    day: d.day,
    label: d.label,
    value: d.value,
  }));
  const visibleSecondaryData = secondaryData?.slice(zoomStart, zoomEnd + 1);
  const secondaryMax = Math.max(1, Math.ceil(Math.max(...(visibleSecondaryData?.map((point) => point.value) ?? [0])) * 1.15));
  const secondaryPts = secondaryData ? visibleData.map((point, i) => ({
    x: padL + i * step,
    y: padT + chartH - ((visibleSecondaryData?.[i]?.value ?? 0) / secondaryMax) * chartH,
    label: point.label,
    value: visibleSecondaryData?.[i]?.value ?? 0,
  })) : [];

  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${padT + chartH} L${pts[0].x.toFixed(1)},${padT + chartH} Z`;
  const secondaryPath = secondaryPts.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const weatherByDay = new Map((weatherData ?? []).map((point) => [point.day, point]));
  const visibleWeather = hasWeather ? visibleData.flatMap((point, dataIndex) => {
    const weather = point.day ? weatherByDay.get(point.day) : undefined;
    return weather ? [{ ...weather, dataIndex, x: padL + dataIndex * step }] : [];
  }) : [];
  const weatherValues = visibleWeather.map((point) => point.value);
  const weatherLow = weatherValues.length ? Math.min(...weatherValues) : 0;
  const weatherHigh = weatherValues.length ? Math.max(...weatherValues) : 1;
  const weatherPadding = Math.max((weatherHigh - weatherLow) * 0.1, 0.5);
  const weatherMinimum = weatherUnit.trim() === "mm" ? 0 : Math.floor(weatherLow - weatherPadding);
  const weatherMaximum = Math.ceil(weatherHigh + weatherPadding);
  const weatherRange = Math.max(weatherMaximum - weatherMinimum, 1);
  const weatherPts = visibleWeather.map((point) => ({ ...point, y: padT + chartH - ((point.value - weatherMinimum) / weatherRange) * chartH }));
  const weatherPath = weatherPts.map((point, index) => `${index && point.dataIndex === weatherPts[index - 1].dataIndex + 1 ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + chartH - f * chartH,
    val: min + f * range,
  }));
  const secondaryTicks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(fraction * secondaryMax)))].map((value) => ({
    value,
    y: padT + chartH - (value / secondaryMax) * chartH,
  }));
  const weatherTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({ value: weatherMinimum + weatherRange * fraction, y: padT + chartH - fraction * chartH }));
  const annotationsByDay = new Map<string, ChartAnnotation[]>();
  if (showNotes) for (const annotation of annotations) annotationsByDay.set(annotation.day, [...(annotationsByDay.get(annotation.day) ?? []), annotation]);

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
      {(weatherData?.length || annotations.length) && <div className="mb-2 flex flex-wrap items-center gap-4 text-xs font-semibold text-taupe">
        {!!weatherData?.length && <label className="flex items-center gap-1.5"><input type="checkbox" checked={showWeather} onChange={(event) => setShowWeather(event.target.checked)} className="accent-sky-600" /><span className="h-0 w-4 border-t-2 border-sky-600" />Weather</label>}
        {!!annotations.length && <label className="flex items-center gap-1.5"><input type="checkbox" checked={showNotes} onChange={(event) => setShowNotes(event.target.checked)} className="accent-violet-600" /><span className="h-2 w-2 rounded-full bg-violet-600" />Notes</label>}
      </div>}
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
        {!hasWeather && secondaryData && secondaryTicks.map((tick) => (
          <text key={`secondary-${tick.value}`} x={W - padR + 6} y={tick.y + 3} textAnchor="start" fontSize={10} fill={secondaryColor}>
            {tick.value}{secondaryUnit}
          </text>
        ))}
        {hasWeather && weatherTicks.map((tick) => <text key={`weather-${tick.value}`} x={W - padR + 6} y={tick.y + 3} textAnchor="start" fontSize={10} fill="#4786a8">{tick.value.toFixed(0)}{weatherUnit}</text>)}

        {/* Area */}
        <path d={areaPath} fill={color} opacity={0.12} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {secondaryData && <path d={secondaryPath} fill="none" stroke={secondaryColor} strokeWidth={2.5} strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />}
        {hasWeather && weatherPath && <path d={weatherPath} fill="none" stroke="#4786a8" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />}

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
              onPointerDown={() => { if (!zoomable) setHover(i); }}
            />
          </g>
        ))}
        {secondaryPts.map((point, index) => (
          <circle key={`secondary-point-${index}`} cx={point.x} cy={point.y} r={hover === index ? 5 : 3} fill="#fff" stroke={secondaryColor} strokeWidth={2} className="cursor-pointer transition-all" onMouseEnter={() => setHover(index)} onPointerDown={() => { if (!zoomable) setHover(index); }} />
        ))}
        {weatherPts.map((point) => <circle key={`weather-${point.day}`} cx={point.x} cy={point.y} r={3} fill="#fff" stroke="#4786a8" strokeWidth={2} className="cursor-pointer" onMouseEnter={() => setHover(Math.round((point.x - padL) / Math.max(step, 1)))} />)}
        {visibleData.map((point, index) => {
          const dayNotes = point.day ? annotationsByDay.get(point.day) ?? [] : [];
          return dayNotes.length ? <g key={`note-${point.day}`} className="cursor-pointer" onMouseEnter={() => setHover(index)}><circle cx={padL + index * step} cy={padT + 5} r={7} fill="#7c5aa6" /><text x={padL + index * step} y={padT + 8} textAnchor="middle" fontSize={8} fontWeight="bold" fill="#fff">{dayNotes.length}</text></g> : null;
        })}

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
          {secondaryData && <div className="text-sm font-bold" style={{ color: secondaryColor }}>{secondaryLabel}: {secondaryPts[hover].value}{secondaryUnit}</div>}
          {hasWeather && pts[hover].day && weatherByDay.get(pts[hover].day) && (() => { const weather = weatherByDay.get(pts[hover].day!)!; return <div className="mt-1 border-t border-line pt-1 text-xs text-sky-700"><strong>{weatherLabel}: {weather.value}{weatherUnit}</strong><br />{weather.condition} · {weather.minimum}–{weather.maximum}°C · {weather.precipitation} mm</div>; })()}
          {showNotes && pts[hover].day && (annotationsByDay.get(pts[hover].day) ?? []).map((note) => <div key={note.id} className="mt-1 max-w-64 border-t border-line pt-1 text-xs text-violet-700"><strong>{note.category}{note.machineName ? ` · ${note.machineName}` : ""}</strong><br />{note.text}</div>)}
        </div>
      )}
    </div>
  );
}
