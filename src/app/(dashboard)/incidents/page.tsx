import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getIncidents, getIncidentPolicies } from "@/lib/data/incidents";
import { getTenants } from "@/lib/data/franchisees";
import { getDisplayTimezone } from "@/lib/timezone";
import { formatDateTime } from "@/lib/dates";
import { setIncidentTypeAutoAssignment } from "@/app/actions/incidents";
import { IncidentAssignment, IncidentCloseControl } from "./IncidentControls";

export const dynamic = "force-dynamic";

const SEVERITY = {
  critical: "border-danger/30 bg-danger/5 text-danger",
  warning: "border-warning/30 bg-warning/5 text-warning",
  info: "border-sage/30 bg-sage/5 text-sage",
};

export default async function IncidentsPage() {
  const session = await getSessionProfile();
  if (!session || session.role === "operator") redirect("/refills");
  const [open, closed, policies, tenants, tz] = await Promise.all([
    getIncidents(session, { status: "open" }),
    getIncidents(session, { status: "closed" }),
    session.role === "admin" ? getIncidentPolicies() : Promise.resolve([]),
    session.role === "admin" ? getTenants().then((rows) => rows.filter((tenant) => tenant.kind === "franchisee")) : Promise.resolve([]),
    getDisplayTimezone(),
  ]);
  const grouped = new Map<string, typeof open>();
  for (const incident of open) grouped.set(incident.machineId, [...(grouped.get(incident.machineId) ?? []), incident]);

  return (
    <div>
      <header className="mb-6"><h1 className="font-display text-3xl font-bold text-cocoa">Incidents</h1><p className="mt-1 text-sm text-taupe">{open.length} open task{open.length === 1 ? "" : "s"} across {grouped.size} machine{grouped.size === 1 ? "" : "s"}</p></header>

      <div className="space-y-3">
        {[...grouped.entries()].map(([machineId, incidents]) => {
          const machine = incidents[0];
          return (
            <details key={machineId} open className="overflow-hidden rounded-2xl border border-line bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4"><span><span className="font-display text-lg font-bold text-cocoa">{machine.machineName}</span><span className="ml-2 text-xs text-taupe">{machine.machineImei ?? ""}</span></span><span className="rounded-full bg-danger/10 px-3 py-1 text-xs font-bold text-danger">{incidents.length} open</span></summary>
              <div className="space-y-3 border-t border-line p-4">
                {incidents.map((incident) => (
                  <article id={`incident-${incident.id}`} key={incident.id} className={`rounded-xl border p-4 ${SEVERITY[incident.severity]}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wide">{incident.severity} · {incident.typeLabel}</span><span className="text-xs text-taupe">Opened {formatDateTime(incident.openedAt, tz)}</span></div>
                    <h2 className="mt-1 font-display text-lg font-bold text-cocoa">{incident.title}</h2>
                    {incident.description && <p className="mt-1 text-sm text-cocoa">{incident.description}</p>}
                    <p className="mt-2 text-xs text-taupe">Assigned to {incident.assignedTenantName ?? "SoftLife admin"}{incident.dueAt ? ` · Due ${formatDateTime(incident.dueAt, tz)}` : ""}</p>
                    <IncidentCloseControl incidentId={incident.id} machineId={incident.machineId} sourceKind={incident.sourceKind} sourceResolved={Boolean(incident.sourceAlertResolvedAt)} />
                    {session.role === "admin" && <IncidentAssignment incidentId={incident.id} assignedTenantId={incident.assignedTenantId} tenants={tenants} />}
                  </article>
                ))}
              </div>
            </details>
          );
        })}
        {!open.length && <p className="rounded-2xl border border-line bg-white p-6 text-sm text-taupe">No open incidents.</p>}
      </div>

      {session.role === "admin" && (
        <details className="mt-8 rounded-2xl border border-line bg-white"><summary className="cursor-pointer list-none px-5 py-4 font-display text-lg font-bold text-cocoa">Automatic franchisee delegation by incident type</summary><div className="grid gap-2 border-t border-line p-4 sm:grid-cols-2">{policies.map((policy) => <form key={policy.incidentType} action={setIncidentTypeAutoAssignment} className="flex items-center justify-between gap-3 rounded-lg bg-cream/50 p-3"><input type="hidden" name="incident_type" value={policy.incidentType} /><input type="hidden" name="enabled" value={policy.autoAssignToFranchisee ? "false" : "true"} /><span className="text-sm font-semibold text-cocoa">{policy.label}</span><button className={`rounded-full px-3 py-1 text-xs font-bold ${policy.autoAssignToFranchisee ? "bg-sage/15 text-sage" : "bg-taupe/15 text-taupe"}`}>{policy.autoAssignToFranchisee ? "Auto-delegated" : "Admin only"}</button></form>)}</div></details>
      )}

      <details className="mt-8 rounded-2xl border border-line bg-white"><summary className="cursor-pointer list-none px-5 py-4 font-display text-lg font-bold text-cocoa">Recent closed incidents ({closed.length} shown)</summary><div className="divide-y divide-line border-t border-line">{closed.map((incident) => <div id={`incident-${incident.id}`} key={incident.id} className="px-5 py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-cocoa">{incident.machineName} · {incident.title}</span><span className="text-sage">Closed {incident.closedAt ? formatDateTime(incident.closedAt, tz) : ""}</span></div><div className="mt-1 text-xs text-taupe">{incident.closureKind === "action_report" && incident.closingActionReportId ? <Link href={`/refills#report-${incident.closingActionReportId}`} className="font-semibold text-terracotta">Closed by Action Report</Link> : "Cleared without Action Report"}</div></div>)}</div></details>
    </div>
  );
}
