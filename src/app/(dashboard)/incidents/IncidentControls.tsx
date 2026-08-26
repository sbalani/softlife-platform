"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createIncident,
  reopenIncident,
  resolveIncident,
  startIncident,
  updateIncidentAssignment,
  type IncidentActionResult,
} from "@/app/actions/incidents";
import type { IncidentPolicy, IncidentWorkspaceOptions } from "@/lib/data/incidents";
import { canTransitionIncident } from "@/lib/incident-workflow";

function Result({ result }: { result: IncidentActionResult | null }) {
  if (!result) return null;
  return <p className={`text-xs font-semibold ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? result.message : result.error}</p>;
}

function localDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function DueInput({ defaultValue }: { defaultValue?: string | null }) {
  const initial = localDateTime(defaultValue ?? null);
  const [value, setValue] = useState(initial);
  const iso = value ? new Date(value).toISOString() : "";
  return <><input type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" /><input type="hidden" name="due_at" value={iso} /></>;
}

export function IncidentCreateForm({ options, policies, isAdmin }: { options: IncidentWorkspaceOptions; policies: IncidentPolicy[]; isAdmin: boolean }) {
  const [result, action, pending] = useActionState<IncidentActionResult | null, FormData>(createIncident, null);
  const [scope, setScope] = useState("machine");
  const [teamId, setTeamId] = useState("");
  const users = options.users.filter((user) => !teamId || !user.tenantId || user.tenantId === teamId);

  return (
    <details open className="mb-7 overflow-hidden rounded-2xl border border-cocoa/15 bg-white shadow-sm">
      <summary className="cursor-pointer list-none bg-cocoa px-5 py-4 text-white"><span className="font-display text-lg font-bold">Report an incident</span><span className="ml-3 text-xs text-white/60">Machine, warehouse, or any other location</span></summary>
      <form action={action} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Where</span><select name="scope_kind" value={scope} onChange={(event) => setScope(event.target.value)} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="machine">Machine</option><option value="warehouse">Warehouse</option><option value="location">Other location</option></select></label>
        {scope === "machine" && <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Machine</span><select required name="machine_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="">Select machine</option>{options.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>}
        {scope === "warehouse" && <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Warehouse</span><select required name="odoo_warehouse_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="">Select warehouse</option>{options.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>}
        {scope === "location" && <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Location</span><input required name="location_text" maxLength={300} placeholder="Store, office, address..." className="w-full rounded-lg border border-line px-3 py-2 text-sm text-cocoa" /></label>}
        <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Priority</span><select name="severity" defaultValue="warning" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Title</span><input required name="title" maxLength={200} placeholder="What needs attention?" className="w-full rounded-lg border border-line px-3 py-2 text-sm text-cocoa" /></label>
        <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Type</span><select required name="incident_type" defaultValue="other" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa">{policies.map((policy) => <option key={policy.incidentType} value={policy.incidentType}>{policy.label}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Due</span><DueInput /></label>
        <label className="sm:col-span-2 lg:col-span-3"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">What happened and what is needed?</span><textarea name="description" maxLength={2000} rows={3} className="w-full rounded-lg border border-line px-3 py-2 text-sm text-cocoa" /></label>
        {isAdmin && <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Owning franchisee</span><select name="owning_tenant_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="">SoftLife</option>{options.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
        {isAdmin && <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Responsible team</span><select name="assigned_tenant_id" value={teamId} onChange={(event) => setTeamId(event.target.value)} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="">SoftLife</option>{options.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
        <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-taupe">Responsible person</span><select name="assigned_user_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}{user.tenantName ? ` · ${user.tenantName}` : ""}</option>)}</select></label>
        <div className="flex items-end gap-3"><button disabled={pending} className="rounded-lg bg-terracotta px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{pending ? "Creating..." : "Create incident"}</button><Result result={result} /></div>
      </form>
    </details>
  );
}

export function ActiveIncidentControls({ incidentId, status, machineId, sourceKind, sourceResolved, assignedTenantId, assignedUserId, dueAt, options, canAssign, isAdmin }: {
  incidentId: string; status: "open" | "in_progress"; machineId: string | null; sourceKind: "alert" | "schedule" | "manual"; sourceResolved: boolean;
  assignedTenantId: string | null; assignedUserId: string | null; dueAt: string | null; options: IncidentWorkspaceOptions; canAssign: boolean; isAdmin: boolean;
}) {
  const [assignmentResult, assignmentAction, assignmentPending] = useActionState<IncidentActionResult | null, FormData>(updateIncidentAssignment, null);
  const [startResult, startAction, startPending] = useActionState<IncidentActionResult | null, FormData>(startIncident, null);
  const [resolveResult, resolveAction, resolvePending] = useActionState<IncidentActionResult | null, FormData>(resolveIncident, null);
  const [teamId, setTeamId] = useState(assignedTenantId ?? "");
  const users = options.users.filter((user) => !teamId || !user.tenantId || user.tenantId === teamId);
  const canResolve = canTransitionIncident(status, "resolved") && (sourceKind !== "alert" || sourceResolved);
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      {canAssign && <form action={assignmentAction} className="grid items-end gap-2 sm:grid-cols-4">
        <input type="hidden" name="incident_id" value={incidentId} />
        {isAdmin && <label><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">Responsible team</span><select name="assigned_tenant_id" value={teamId} onChange={(event) => setTeamId(event.target.value)} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-cocoa"><option value="">SoftLife</option>{options.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
        <label><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">Responsible person</span><select name="assigned_user_id" defaultValue={assignedUserId ?? ""} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-cocoa"><option value="">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}{user.tenantName ? ` · ${user.tenantName}` : ""}</option>)}</select></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">Due</span><DueInput defaultValue={dueAt} /></label>
        <div><button disabled={assignmentPending} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa disabled:opacity-50">{assignmentPending ? "Saving..." : "Update responsibility"}</button></div>
        <Result result={assignmentResult} />
      </form>}
      <div className="flex flex-wrap items-start gap-2">
        {canTransitionIncident(status, "in_progress") && <form action={startAction}><input type="hidden" name="incident_id" value={incidentId} /><button disabled={startPending} className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{startPending ? "Starting..." : "Start work"}</button></form>}
        {machineId && <Link href={`/refills?machine=${encodeURIComponent(machineId)}&incident=${encodeURIComponent(incidentId)}`} className="rounded-lg border border-terracotta/30 bg-terracotta/5 px-3 py-2 text-xs font-bold text-terracotta">Add Action Report</Link>}
        <Result result={startResult} />
      </div>
      <form action={resolveAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="incident_id" value={incidentId} />
        <label className="flex-1"><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">How was this resolved?</span><textarea required name="resolution_summary" maxLength={2000} rows={2} disabled={!canResolve} placeholder={canResolve ? "Record the outcome and work completed" : "Telemetry still reports the source alert as active"} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-cocoa disabled:bg-cream" /></label>
        <button disabled={resolvePending || !canResolve} className="rounded-lg bg-sage px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{resolvePending ? "Resolving..." : "Resolve"}</button>
        <Result result={resolveResult} />
      </form>
    </div>
  );
}

export function ReopenIncidentControl({ incidentId }: { incidentId: string }) {
  const [result, action, pending] = useActionState<IncidentActionResult | null, FormData>(reopenIncident, null);
  return <form action={action} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"><input type="hidden" name="incident_id" value={incidentId} /><label className="flex-1"><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">Reason to reopen</span><input required name="reason" maxLength={2000} className="w-full rounded-lg border border-line px-3 py-2 text-xs text-cocoa" /></label><button disabled={pending} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-cocoa disabled:opacity-50">{pending ? "Reopening..." : "Reopen"}</button><Result result={result} /></form>;
}
