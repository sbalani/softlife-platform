"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearDefrostIntervention } from "./actions";

export function ClearDefrostInterventionButton({ machineId, imei }: { machineId: string; imei: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="mt-3 flex items-center gap-3"><button type="button" disabled={pending} onClick={() => {
    if (!confirm("Confirm the machine was inspected, defrost is off, refrigeration is on, and it is safe to clear the intervention latch.")) return;
    startTransition(async () => {
      const result = await clearDefrostIntervention(machineId, imei);
      setError(result.ok ? null : result.error ?? "Could not clear intervention.");
      if (result.ok) router.refresh();
    });
  }} className="rounded-lg border border-danger px-3 py-2 text-xs font-bold text-danger disabled:opacity-50">{pending ? "Clearing..." : "Inspection complete · clear intervention"}</button>{error && <span className="text-xs font-semibold text-danger">{error}</span>}</div>;
}
