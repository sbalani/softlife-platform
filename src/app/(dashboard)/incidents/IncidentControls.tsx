"use client";

import Link from "next/link";
import { useActionState } from "react";
import { assignIncident, closeIncidentWithoutReport, type IncidentActionResult } from "@/app/actions/incidents";

export function IncidentCloseControl({ incidentId, machineId, sourceKind, sourceResolved }: { incidentId: string; machineId: string; sourceKind: "alert" | "schedule" | "manual"; sourceResolved: boolean }) {
  const [result, action, pending] = useActionState<IncidentActionResult | null, FormData>(closeIncidentWithoutReport, null);
  return (
    <div className="mt-3 rounded-lg border border-line bg-white p-3">
      <p className={`text-xs font-semibold ${sourceResolved ? "text-sage" : "text-warning"}`}>
        {sourceKind === "alert" ? sourceResolved ? "Telemetry shows this issue is resolved. Should this incident be cleared, or is an Action Report needed?" : "Telemetry still reports this issue as active. Complete an Action Report when the work is done." : "Complete an Action Report when this scheduled task is done."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={`/refills?machine=${encodeURIComponent(machineId)}&incident=${encodeURIComponent(incidentId)}`} className="rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white">Create Action Report</Link>
        {sourceKind === "alert" && sourceResolved && <form action={action}><input type="hidden" name="incident_id" value={incidentId} /><button disabled={pending} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-cocoa disabled:opacity-50">{pending ? "Clearing..." : "Clear without Action Report"}</button></form>}
        {result && !result.ok && <span className="text-xs font-semibold text-danger">{result.error}</span>}
      </div>
    </div>
  );
}

export function IncidentAssignment({ incidentId, assignedTenantId, tenants }: { incidentId: string; assignedTenantId: string | null; tenants: { id: string; name: string }[] }) {
  const [result, action, pending] = useActionState<IncidentActionResult | null, FormData>(assignIncident, null);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="incident_id" value={incidentId} />
      <label><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">Delegate to franchisee</span><select name="tenant_id" defaultValue={assignedTenantId ?? ""} className="rounded-lg border border-line bg-white px-3 py-2 text-xs text-cocoa"><option value="">SoftLife admin</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
      <button disabled={pending} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa disabled:opacity-50">{pending ? "Saving..." : "Assign"}</button>
      {result && !result.ok && <span className="text-xs font-semibold text-danger">{result.error}</span>}
    </form>
  );
}
