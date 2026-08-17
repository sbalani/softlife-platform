"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DefrostRunSummary } from "@/lib/data/machine-config";
import { runDefrostNow } from "./defrost-actions";

const ACTIVE_STATES = new Set(["scheduled", "thawing", "thaw_closed", "refrigeration_check", "forming", "sales_check", "recovery"]);

const STATE_LABELS: Record<string, string> = {
  scheduled: "Queued",
  thawing: "Defrosting",
  thaw_closed: "Defrost stopped",
  refrigeration_check: "Confirming refrigeration",
  forming: "Re-forming ice cream",
  sales_check: "Confirming sales",
  recovery: "Safe recovery",
  completed: "Completed",
  failed: "Failed",
  manual_intervention: "Manual intervention",
};

export function DefrostRunPanel({ machineId, machineName, imei, deployed, durationMinutes, requiresIntervention, runs }: {
  machineId: string;
  machineName: string;
  imei: string;
  deployed: boolean;
  durationMinutes: number;
  requiresIntervention: boolean;
  runs: DefrostRunSummary[];
}) {
  const router = useRouter();
  const active = runs.find((run) => ACTIVE_STATES.has(run.state));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [active, router]);

  function start() {
    if (!confirm(`Run a ${durationMinutes}-minute defrost cycle on ${machineName} (${imei}) now?\n\nSales will be disabled. The platform will stop refrigeration, run defrost, restart refrigeration, wait for 100% formation, and confirm sales resume.`)) return;
    const requestId = crypto.randomUUID();
    setResult(null);
    startTransition(async () => {
      const response = await runDefrostNow(machineId, imei, requestId);
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  const blockedReason = !deployed ? "Deploy this machine first." : requiresIntervention ? "Clear the intervention latch first." : active ? "A cycle is already active." : null;
  return (
    <section className="mt-5 rounded-xl border border-line bg-cream/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-cocoa">Defrost control</h3>
          <p className="mt-1 max-w-2xl text-xs text-taupe">Manual and scheduled cycles use the same audited workflow. Commands are spaced by two seconds; refrigeration, formation, and resumed sales are verified from live Huaxin status.</p>
        </div>
        <button type="button" onClick={start} disabled={pending || !!blockedReason} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Queueing..." : `Run defrost now · ${durationMinutes} min`}
        </button>
      </div>
      {blockedReason && <p className="mt-2 text-xs font-semibold text-warning">{blockedReason}</p>}
      {result && <p className={`mt-2 text-xs font-semibold ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Defrost cycle queued." : result.error}</p>}
      {active && (
        <div className={`mt-4 rounded-lg border px-3 py-3 ${active.state === "recovery" ? "border-danger/40 bg-danger/10" : "border-terracotta/30 bg-white"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-bold text-cocoa">{STATE_LABELS[active.state] ?? active.state}</span><span className="text-[10px] uppercase tracking-wide text-taupe">{active.triggerKind} cycle</span></div>
          <div className="mt-1 text-xs text-taupe">Started {new Date(active.startedAt ?? active.scheduledFor).toLocaleString("en-GB")}{active.lastFormationPct != null ? ` · Formation ${active.lastFormationPct}%` : ""}{active.refrigerationAttempts > 1 ? ` · Fridge attempts ${active.refrigerationAttempts}` : ""}{active.salesAttempts > 1 ? ` · Sales attempts ${active.salesAttempts}` : ""}</div>
          {active.failureDetail && <div className="mt-1 text-xs font-semibold text-danger">{active.failureDetail}</div>}
        </div>
      )}
      {runs.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-xs"><thead className="text-left text-[10px] uppercase text-taupe"><tr><th className="py-2">Requested</th><th>Source</th><th>Outcome</th><th>Formation</th><th>Retries</th></tr></thead><tbody className="divide-y divide-line">{runs.slice(0, 5).map((run) => <tr key={run.id}><td className="py-2 text-cocoa">{new Date(run.scheduledFor).toLocaleString("en-GB")}</td><td className="capitalize text-cocoa">{run.triggerKind}</td><td className={run.state === "completed" ? "font-semibold text-sage" : run.state === "failed" || run.state === "manual_intervention" || run.state === "recovery" ? "font-semibold text-danger" : "font-semibold text-warning"}>{STATE_LABELS[run.state] ?? run.state}</td><td className="text-cocoa">{run.lastFormationPct == null ? "—" : `${run.lastFormationPct}%`}</td><td className="text-taupe">Fridge {Math.max(0, run.refrigerationAttempts - 1)} · Sales {Math.max(0, run.salesAttempts - 1)}</td></tr>)}</tbody></table>
        </div>
      )}
    </section>
  );
}
