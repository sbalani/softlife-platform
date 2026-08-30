"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearDefrostIntervention } from "./actions";

export function ClearDefrostInterventionButton({ machineId, imei, activeState }: { machineId: string; imei: string; activeState: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const workflowActive = activeState !== null;
  const explanation = activeState === "recovery"
    ? "Automatic cup-anomaly recovery is active. The lock stays in place until the cup signal clears and the machine passes its defrost-off, refrigeration-on, formation, and sales checks."
    : workflowActive
      ? `The automated workflow is ${activeState.replaceAll("_", " ")}. The lock cannot be cleared until it finishes.`
      : "The automated workflow has stopped. Clear the lock only after physically inspecting the machine.";
  return <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3"><p className="text-xs font-semibold text-danger">Intervention lock active</p><p className="mt-1 text-xs text-cocoa">{explanation}</p><div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" disabled={pending || workflowActive} onClick={() => {
    if (!confirm("Confirm the machine was inspected, defrost is off, refrigeration is on, and it is safe to clear the intervention latch.")) return;
    startTransition(async () => {
      const result = await clearDefrostIntervention(machineId, imei);
      setError(result.ok ? null : result.error ?? "Could not clear intervention.");
      if (result.ok) router.refresh();
    });
  }} className="rounded-lg border border-danger px-3 py-2 text-xs font-bold text-danger disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Clearing..." : workflowActive ? "Clear unavailable during active workflow" : "Inspection complete · clear intervention"}</button>{error && <span className="text-xs font-semibold text-danger">{error}</span>}</div></div>;
}
