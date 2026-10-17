"use client";

import { useActionState } from "react";
import { resolveMachineIncident, type IncidentActionResult } from "@/app/actions/incidents";

export function MachineIncidentResolution({ incidentId, imei, sourceKind, sourceResolved, sourceResolutionSource }: {
  incidentId: string;
  imei: string;
  sourceKind: "alert" | "schedule" | "manual" | "public";
  sourceResolved: boolean;
  sourceResolutionSource: "telemetry" | "manual_dismissal" | "safety_clearance" | null;
}) {
  const [result, action, pending] = useActionState<IncidentActionResult | null, FormData>(resolveMachineIncident, null);

  if (sourceKind === "alert" && !sourceResolved) {
    return <p className="mt-2 text-[11px] font-semibold text-warning">The source alert is still active. Sync or resolve the alert before dismissing this incident.</p>;
  }

  if (sourceKind === "alert" && !["telemetry", "safety_clearance"].includes(sourceResolutionSource ?? "")) {
    return <p className="mt-2 text-[11px] font-semibold text-warning">This alert was dismissed manually, so telemetry recovery is not confirmed. Sync the machine before closing its incident.</p>;
  }

  if (sourceKind === "alert") {
    return (
      <form action={action} onSubmit={(event) => {
        if (!confirm("Remove this recovered incident from the open list? This records an audited direct resolution without an Action Report.")) event.preventDefault();
      }} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="incident_id" value={incidentId} />
        <input type="hidden" name="imei" value={imei} />
        <input type="hidden" name="resolution_summary" value={sourceResolutionSource === "safety_clearance" ? "The audited safety intervention was cleared; no Action Report was required." : "Source alert recovered automatically; no further action was required."} />
        <button disabled={pending} className="rounded-lg border border-sage/40 bg-sage/10 px-3 py-1.5 text-xs font-bold text-sage disabled:opacity-50">{pending ? "Dismissing..." : sourceResolutionSource === "safety_clearance" ? "Dismiss inspected incident" : "Dismiss resolved incident"}</button>
        {result && !result.ok && <span className="text-xs font-semibold text-danger">{result.error}</span>}
      </form>
    );
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-bold text-terracotta">Resolve without Action Report</summary>
      <form action={action} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="incident_id" value={incidentId} />
        <input type="hidden" name="imei" value={imei} />
        <label className="flex-1"><span className="mb-1 block text-[10px] font-bold uppercase text-taupe">Resolution note</span><input required name="resolution_summary" maxLength={2000} placeholder="Why no further action is needed" className="w-full rounded-lg border border-line px-3 py-2 text-xs text-cocoa" /></label>
        <button disabled={pending} className="rounded-lg bg-sage px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Resolving..." : "Resolve incident"}</button>
        {result && <span className={`text-xs font-semibold ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? result.message : result.error}</span>}
      </form>
    </details>
  );
}
