import { getAlerts } from "@/lib/data/alerts";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const SEV: Record<string, { ring: string; dot: string; label: string }> = {
  critical: { ring: "border-danger/30", dot: "bg-danger", label: "Critical" },
  warning: { ring: "border-warning/30", dot: "bg-warning", label: "Warning" },
  info: { ring: "border-sage/30", dot: "bg-sage", label: "Info" },
};

export default async function AlertsPage() {
  const { alerts, source } = await getAlerts();
  const tz = await getDisplayTimezone();
  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Alerts</h1>
        <p className="mt-1 text-sm text-taupe">{alerts.length} active alert{alerts.length === 1 ? "" : "s"}</p>
      </header>

      <div className="space-y-3">
        {alerts.map((a) => {
          const sev = SEV[a.severity] ?? SEV.info;
          return (
            <article key={a.id} className={`rounded-2xl border ${sev.ring} bg-white p-5`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-taupe">
                      {a.type.replace("_", " ")}
                    </span>
                    <span className="text-xs font-bold" style={{ color: a.severity === "critical" ? "#dc2626" : a.severity === "warning" ? "#d97706" : "#6fa98c" }}>
                      {sev.label}
                    </span>
                    {a.machine_name && (
                      <span className="text-xs text-taupe">· {a.machine_name}</span>
                    )}
                  </div>
                  <p className="mt-1.5 font-semibold text-cocoa">{a.message}</p>
                  <p className="mt-1 text-xs text-taupe">{formatDateTime(a.created_at, tz)}</p>
                </div>
                {a.remaining_pct != null && (
                  <div className="text-right">
                    <div className="font-display text-2xl font-bold text-cocoa">{a.remaining_pct}%</div>
                    <div className="text-[11px] uppercase tracking-wide text-taupe">remaining</div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {source === "sample" && (
        <p className="mt-4 text-xs text-taupe">Sample data — connect Supabase to see live alerts.</p>
      )}
    </div>
  );
}
