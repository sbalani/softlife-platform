/** Lightweight, dependency-free charts (SVG + CSS) in SoftLife brand colours. */

export function KpiCard({
  label,
  value,
  hint,
  accent = "#d47e54",
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        <div className="text-[11px] uppercase tracking-wide text-taupe">{label}</div>
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-cocoa">{value}</div>
      {hint && <div className="mt-1 text-xs text-taupe">{hint}</div>}
    </div>
  );
}

// ---- Interactive line chart with axes + tooltips ----

export function LineChart({
  data,
  color = "#d47e54",
  height = 200,
  unit = "€",
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  unit?: string;
}) {
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

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#e6e0da" strokeWidth={1} />
            <text x={padL - 6} y={t.y + 3} textAnchor="end" fontSize={10} fill="#927c6c">
              {unit === "€" ? `€${t.val.toFixed(0)}` : t.val.toFixed(0)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={color} opacity={0.12} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {pts.map((p, i) => (
          <g key={i} className="cursor-pointer">
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke={color} strokeWidth={2}>
              <title>{`${p.label}: ${unit === "€" ? "€" : ""}${p.value.toFixed(2)}${unit !== "€" ? unit : ""}`}</title>
            </circle>
          </g>
        ))}

        {pts.map((p, i) =>
          i % xStride === 0 || i === pts.length - 1 ? (
            <text key={i} x={p.x} y={H - padB + 14} textAnchor="middle" fontSize={9} fill="#927c6c">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function VBarChart({
  data,
  color = "#d47e54",
  unit = "",
  formatValue,
}: {
  data: { label: string; value: number; href?: string }[];
  color?: string;
  unit?: string;
  formatValue?: (v: number) => string;
}) {
  if (!data.length) {
    return <div className="flex h-52 items-center justify-center text-sm text-taupe">No data</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 0.01);
  const fmt = formatValue ?? ((v: number) => `${v}${unit}`);
  return (
    <div className="flex h-52 items-end justify-between gap-4">
      {data.map((d) => {
        const pct = max > 0 ? (d.value / max) * 100 : 0;
        const inner = (
          <>
            <div className="text-xs font-bold text-cocoa">{fmt(d.value)}</div>
            <div className="flex w-full flex-1 items-end justify-center">
              <div
                className="w-full max-w-[56px] rounded-t-lg transition-all"
                style={{ height: `${Math.max(pct, 1.5)}%`, minHeight: 3, background: color }}
              />
            </div>
            <div className="w-full truncate text-center text-[11px] text-taupe" title={d.label}>{d.label}</div>
          </>
        );
        return d.href ? (
          <a key={d.label} href={d.href} className="flex flex-1 cursor-pointer flex-col items-center gap-2 no-underline transition hover:opacity-80" style={{ height: "100%" }}>
            {inner}
          </a>
        ) : (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-2" style={{ height: "100%" }}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export function HBarChart({
  data,
  color = "#d47e54",
  unit = "",
}: {
  data: { label: string; value: number }[];
  color?: string;
  unit?: string;
}) {
  if (!data.length) {
    return <div className="flex h-32 items-center justify-center text-sm text-taupe">No data</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 0.01);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <div className="w-48 shrink-0 truncate text-xs text-cocoa" title={d.label}>{d.label}</div>
          <div className="h-6 flex-1 overflow-hidden rounded bg-cream/60">
            <div className="h-full rounded transition-all" style={{ width: `${Math.max((d.value / max) * 100, 2)}%`, minWidth: "4px", background: color }} />
          </div>
          <div className="w-12 text-right text-xs font-bold text-cocoa">{d.value}{unit}</div>
        </div>
      ))}
    </div>
  );
}
