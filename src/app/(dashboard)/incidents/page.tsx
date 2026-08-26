import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getIncidents, getIncidentPolicies, getIncidentWorkspaceOptions, type Incident } from "@/lib/data/incidents";
import { getDisplayTimezone } from "@/lib/timezone";
import { formatDateTime } from "@/lib/dates";
import { setIncidentTypeAutoAssignment } from "@/app/actions/incidents";
import { ActiveIncidentControls, IncidentCreateForm, ReopenIncidentControl } from "./IncidentControls";

export const dynamic = "force-dynamic";

const SEVERITY = {
  critical: "border-danger/30 bg-danger/5 text-danger",
  warning: "border-warning/30 bg-warning/5 text-warning",
  info: "border-sage/30 bg-sage/5 text-sage",
};

const EVENT_LABEL: Record<string, string> = {
  created: "Created", alert_updated: "Alert updated", assigned: "Responsibility updated", started: "Work started",
  resolved: "Resolved", reopened: "Reopened", action_report_linked: "Action Report linked",
};

function incidentLocation(incident: Incident) {
  if (incident.scopeKind === "machine") return incident.machineName ?? "Unknown machine";
  if (incident.scopeKind === "warehouse") return incident.warehouseName ?? "Unknown warehouse";
  return incident.locationText ?? "Location not recorded";
}

function Timeline({ incident, tz }: { incident: Incident; tz: string }) {
  return <details className="mt-3 rounded-lg bg-white/70"><summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold text-cocoa">History ({incident.events.length})</summary><ol className="space-y-3 border-t border-line px-3 py-3">{incident.events.map((event) => <li key={event.id} className="relative pl-4 text-xs before:absolute before:left-0 before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-terracotta"><div className="flex flex-wrap justify-between gap-2"><span className="font-bold text-cocoa">{EVENT_LABEL[event.type] ?? event.type.replaceAll("_", " ")}</span><time className="text-taupe">{formatDateTime(event.createdAt, tz)}</time></div>{event.message && <p className="mt-0.5 text-taupe">{event.message}</p>}{event.actorName && <p className="mt-0.5 text-[10px] text-taupe">By {event.actorName}</p>}</li>)}</ol></details>;
}

export default async function IncidentsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login?next=/incidents");
  const [active, resolved, policies, options, tz] = await Promise.all([
    getIncidents(session, { status: "open" }),
    getIncidents(session, { status: "resolved" }),
    getIncidentPolicies(),
    getIncidentWorkspaceOptions(session),
    getDisplayTimezone(),
  ]);
  const inProgress = active.filter((incident) => incident.status === "in_progress").length;
  const overdue = active.filter((incident) => incident.overdue).length;

  return (
    <div>
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-terracotta">Operations desk</p><h1 className="font-display text-3xl font-bold text-cocoa">Incidents</h1><p className="mt-1 text-sm text-taupe">One queue for every operational issue, from report to documented resolution.</p></div><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white px-4 py-2"><strong className="block text-xl text-cocoa">{active.length}</strong><span className="text-[10px] font-bold uppercase text-taupe">Active</span></div><div className="rounded-xl bg-white px-4 py-2"><strong className="block text-xl text-cocoa">{inProgress}</strong><span className="text-[10px] font-bold uppercase text-taupe">In progress</span></div><div className="rounded-xl bg-danger/5 px-4 py-2"><strong className="block text-xl text-danger">{overdue}</strong><span className="text-[10px] font-bold uppercase text-danger">Overdue</span></div></div></header>

      {session.role !== "operator" && <IncidentCreateForm options={options} policies={policies} isAdmin={session.role === "admin"} />}

      <section>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-xl font-bold text-cocoa">Active work</h2><span className="text-xs text-taupe">Ordered by latest report</span></div>
        <div className="grid gap-4 xl:grid-cols-2">
          {active.map((incident) => {
            const isOverdue = incident.overdue;
            return <article id={`incident-${incident.id}`} key={incident.id} className={`rounded-2xl border p-5 ${SEVERITY[incident.severity]}`}>
              <div className="flex flex-wrap items-start justify-between gap-2"><div><span className="text-[10px] font-bold uppercase tracking-wide">{incident.severity} · {incident.typeLabel} · {incident.sourceKind}</span><h3 className="mt-1 font-display text-xl font-bold text-cocoa">{incident.title}</h3></div><span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${incident.status === "in_progress" ? "bg-cocoa text-white" : "bg-white text-cocoa"}`}>{incident.status.replace("_", " ")}</span></div>
              <p className="mt-2 text-sm font-semibold text-cocoa">{incidentLocation(incident)}</p>
              {incident.machineImei && <p className="text-xs text-taupe">IMEI {incident.machineImei}</p>}
              {incident.description && <p className="mt-2 text-sm text-cocoa">{incident.description}</p>}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-taupe"><span>Opened {formatDateTime(incident.openedAt, tz)}</span><span className={isOverdue ? "font-bold text-danger" : ""}>{incident.dueAt ? `Due ${formatDateTime(incident.dueAt, tz)}` : "No due date"}</span><span>Team: {incident.assignedTenantName ?? incident.owningTenantName ?? "SoftLife"}</span><span>Person: {incident.assignedUserName ?? "Unassigned"}</span></div>
              <ActiveIncidentControls incidentId={incident.id} status={incident.status as "open" | "in_progress"} machineId={incident.machineId} sourceKind={incident.sourceKind} sourceResolved={Boolean(incident.sourceAlertResolvedAt)} assignedTenantId={incident.assignedTenantId} assignedUserId={incident.assignedUserId} dueAt={incident.dueAt} options={options} canAssign={session.role !== "operator"} isAdmin={session.role === "admin"} />
              <Timeline incident={incident} tz={tz} />
            </article>;
          })}
          {!active.length && <p className="rounded-2xl border border-line bg-white p-6 text-sm text-taupe xl:col-span-2">No active incidents. New reports will appear here.</p>}
        </div>
      </section>

      <details className="mt-8 overflow-hidden rounded-2xl border border-line bg-white"><summary className="cursor-pointer list-none px-5 py-4 font-display text-lg font-bold text-cocoa">Resolved incidents ({resolved.length} shown)</summary><div className="divide-y divide-line border-t border-line">{resolved.map((incident) => <article id={`incident-${incident.id}`} key={incident.id} className="px-5 py-4"><div className="flex flex-wrap justify-between gap-2"><div><span className="font-semibold text-cocoa">{incidentLocation(incident)} · {incident.title}</span><p className="mt-1 text-xs text-taupe">{incident.resolutionSummary}</p></div><span className="text-xs font-semibold text-sage">Resolved {incident.resolvedAt ? formatDateTime(incident.resolvedAt, tz) : ""}</span></div>{incident.closureKind === "action_report" && incident.closingActionReportId && <Link href={`/refills#report-${incident.closingActionReportId}`} className="mt-2 inline-block text-xs font-semibold text-terracotta">View Action Report</Link>}<Timeline incident={incident} tz={tz} /><ReopenIncidentControl incidentId={incident.id} /></article>)}</div></details>

      {session.role === "admin" && <details className="mt-8 rounded-2xl border border-line bg-white"><summary className="cursor-pointer list-none px-5 py-4 font-display text-lg font-bold text-cocoa">Automatic franchisee delegation by incident type</summary><div className="grid gap-2 border-t border-line p-4 sm:grid-cols-2">{policies.map((policy) => <form key={policy.incidentType} action={setIncidentTypeAutoAssignment} className="flex items-center justify-between gap-3 rounded-lg bg-cream/50 p-3"><input type="hidden" name="incident_type" value={policy.incidentType} /><input type="hidden" name="enabled" value={policy.autoAssignToFranchisee ? "false" : "true"} /><span className="text-sm font-semibold text-cocoa">{policy.label}</span><button className={`rounded-full px-3 py-1 text-xs font-bold ${policy.autoAssignToFranchisee ? "bg-sage/15 text-sage" : "bg-taupe/15 text-taupe"}`}>{policy.autoAssignToFranchisee ? "Auto-delegated" : "Admin only"}</button></form>)}</div></details>}
    </div>
  );
}
