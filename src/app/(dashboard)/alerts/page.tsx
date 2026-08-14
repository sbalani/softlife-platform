import Link from "next/link";
import { getAlerts } from "@/lib/data/alerts";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getChangeAlertRules } from "@/lib/data/change-alert-rules";
import { getMachines } from "@/lib/data/machines";
import { getProducts } from "@/lib/data/products";
import { AlertRuleManager } from "./AlertRuleManager";
import { ResolveAlertButton } from "./ResolveAlertButton";

export const dynamic = "force-dynamic";

const SEV: Record<string, { ring: string; dot: string; label: string }> = {
  critical: { ring: "border-danger/30", dot: "bg-danger", label: "Critical" },
  warning: { ring: "border-warning/30", dot: "bg-warning", label: "Warning" },
  info: { ring: "border-sage/30", dot: "bg-sage", label: "Info" },
};

export default async function AlertsPage() {
  const [{ alerts, source }, { alerts: history }, tz, rules, { machines }, products] = await Promise.all([getAlerts(), getAlerts(true), getDisplayTimezone(), getChangeAlertRules(), getMachines(), getProducts()]);
  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Alerts</h1>
        <p className="mt-1 text-sm text-taupe">{alerts.length} active alert{alerts.length === 1 ? "" : "s"}</p>
      </header>

      <AlertRuleManager rules={rules} machines={machines} products={products.map(({ id, name }) => ({ id, name }))} />

      <h2 className="mb-3 font-display text-xl font-bold text-cocoa">Active alerts</h2>
      <div className="space-y-3">
        {alerts.map((a) => {
          const sev = SEV[a.severity] ?? SEV.info;
          return (
            <article key={a.id} className={`rounded-2xl border ${sev.ring} bg-white p-5`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold" style={{ color: a.severity === "critical" ? "#dc2626" : a.severity === "warning" ? "#d97706" : "#6fa98c" }}>
                      {sev.label}
                    </span>
                    {a.machine_name && (
                      a.device_imei
                        ? <Link href={`/machines/${a.device_imei}`} className="text-xs font-semibold text-terracotta hover:underline">· {a.machine_name}</Link>
                        : <span className="text-xs text-taupe">· {a.machine_name}</span>
                    )}
                    {a.product_name && <span className="text-xs text-taupe">· {a.product_name}</span>}
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-cocoa">{a.title}</h3>
                  <p className="mt-1 text-sm text-cocoa">{a.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-taupe"><span>{formatDateTime(a.created_at, tz)}</span>{a.change_log_id && <Link href={`/change-log?${new URLSearchParams({ ...(a.device_imei ? { machine: a.device_imei } : {}), ...(a.change_field ? { field: a.change_field } : {}) })}`} className="font-semibold text-terracotta">Technical details</Link>}<ResolveAlertButton id={a.id} /></div>
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
      {alerts.length === 0 && <p className="rounded-2xl border border-line bg-white p-5 text-sm text-taupe">No active alerts.</p>}
      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl font-bold text-cocoa">Alert history</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe"><tr><th className="px-4 py-3">Machine</th><th className="px-4 py-3">Alert</th><th className="px-4 py-3">Started</th><th className="px-4 py-3">Recovered</th></tr></thead>
            <tbody className="divide-y divide-line">
              {history.map((alert) => <tr key={alert.id}><td className="px-4 py-3 font-semibold text-cocoa">{alert.device_imei ? <Link href={`/machines/${alert.device_imei}`} className="hover:text-terracotta hover:underline">{alert.machine_name ?? alert.device_imei}</Link> : alert.machine_name ?? "—"}</td><td className="px-4 py-3 text-cocoa"><div className="font-semibold">{alert.title}</div><div className="text-xs text-taupe">{alert.message}</div></td><td className="px-4 py-3 text-taupe">{formatDateTime(alert.created_at, tz)}</td><td className="px-4 py-3 font-semibold text-sage">{formatDateTime(alert.resolved_at!, tz)}</td></tr>)}
              {history.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-taupe">No recovered alerts yet. New alert cycles will remain here after recovery.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {source === "sample" && (
        <p className="mt-4 text-xs text-taupe">Sample data — connect Supabase to see live alerts.</p>
      )}
    </div>
  );
}
