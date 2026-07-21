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

// ---- Legacy AreaChart (used by machine temperature page) ----

export function AreaChart({
  data,
  color = "#d47e54",
  height = 130,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  if (!data.length) {
    return <div className="flex items-center justify-center text-sm text-taupe" style={{ height }}>No data</div>;
  }
  const w = 360;
  const h = height;
  const pad = 10;
  const max = Math.max(...data.map((d) => d.value), 1);
  const step = (w - pad * 2) / Math.max(data.length - 1, 1);
  const pts = data.map((d, i) => [
    pad + i * step,
    h - pad - (d.value / max) * (h - pad * 2),
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
      <path d={area} fill={color} opacity={0.16} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}

// ---- LineChart moved to its own client component (LineChart.tsx) ----
// The AreaChart below remains for the machine temperature page.

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
