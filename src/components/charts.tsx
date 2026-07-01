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

export function AreaChart({
  data,
  color = "#d47e54",
}: {
  data: { label: string; value: number }[];
  color?: string;
}) {
  const w = 360;
  const h = 130;
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
    <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full">
      <path d={area} fill={color} opacity={0.16} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}

export function VBarChart({
  data,
  color = "#d47e54",
}: {
  data: { label: string; value: number }[];
  color?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-52 items-end justify-between gap-4">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
          <div className="text-xs font-bold text-cocoa">{d.value}</div>
          <div className="flex w-full items-end justify-center" style={{ height: "100%" }}>
            <div
              className="w-full max-w-[56px] rounded-t-lg"
              style={{
                height: `${(d.value / max) * 100}%`,
                minHeight: 6,
                background: color,
              }}
            />
          </div>
          <div className="w-full truncate text-center text-[11px] text-taupe">{d.label}</div>
        </div>
      ))}
    </div>
  );
}
