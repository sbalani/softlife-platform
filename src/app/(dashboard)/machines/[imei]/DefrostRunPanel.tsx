"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DefrostRunSummary } from "@/lib/data/machine-config";
import { isHuaxinClosed, isHuaxinOpen, isHuaxinSalesBlocked, isHuaxinSalesReady } from "@/lib/defrost-status";
import { sendMachineCommand } from "./actions";
import { runDefrostNow } from "./defrost-actions";

const ACTIVE_STATES = new Set(["scheduled", "thawing", "thaw_closed", "refrigeration_check", "forming", "sales_check", "recovery"]);

const STATE_LABELS: Record<string, string> = {
  scheduled: "Queued",
  thawing: "Defrosting",
  thaw_closed: "Defrost stopped",
  refrigeration_check: "Confirming refrigeration",
  forming: "Re-forming ice cream",
  sales_check: "Confirming sales",
  recovery: "Cup anomaly recovery",
  completed: "Completed",
  skipped: "Skipped",
  failed: "Failed",
  manual_intervention: "Manual intervention",
};

export function DefrostRunPanel({ machineId, machineName, imei, deployed, online, statusCurrent, refrigerationValue, defrostValue, formationPct, operatingValue, durationMinutes, requiresIntervention, runs }: {
  machineId: string;
  machineName: string;
  imei: string;
  deployed: boolean;
  online: boolean;
  statusCurrent: boolean;
  refrigerationValue: string | null;
  defrostValue: string | null;
  formationPct: number | null;
  operatingValue: string | null;
  durationMinutes: number;
  requiresIntervention: boolean;
  runs: DefrostRunSummary[];
}) {
  const router = useRouter();
  const active = runs.find((run) => ACTIVE_STATES.has(run.state));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; message?: string } | null>(null);

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
      setResult(response.ok ? { ok: true, message: "Defrost cycle queued." } : response);
      if (response.ok) router.refresh();
    });
  }

  const safeToResume = online && statusCurrent && !active && !requiresIntervention
    && isHuaxinOpen(refrigerationValue) && isHuaxinClosed(defrostValue) && formationPct === 100
    && isHuaxinSalesBlocked(operatingValue);
  const salesReady = statusCurrent && isHuaxinSalesReady(operatingValue);

  function resumeSales() {
    if (!confirm(`Resume customer sales on ${machineName} (${imei})? Refrigeration is on, defrost is off, and formation is 100%.`)) return;
    setResult(null);
    startTransition(async () => {
      const response = await sendMachineCommand(imei, "operate_onsale");
      setResult(response.ok ? { ok: true, message: "Resume-sales command accepted. Sync the machine to confirm it is selling." } : response);
      if (response.ok) router.refresh();
    });
  }

  const blockedReason = !deployed
    ? "Deploy this machine first."
    : !online
      ? "Machine offline. Restore its connection before starting a defrost cycle."
    : active?.state === "recovery"
      ? "Waiting for the cup anomaly to clear; physical defrost is not running."
      : active
        ? "An automated cycle is already active."
        : requiresIntervention
          ? "Inspect the machine and clear the intervention lock first."
          : null;
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
      {(active || requiresIntervention || runs[0]?.state === "manual_intervention" || isHuaxinSalesBlocked(operatingValue)) && <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
        <p className="text-xs font-bold text-cocoa">Recovery status</p>
        {active ? <p className="mt-1 text-xs text-cocoa">The automated workflow is still {STATE_LABELS[active.state]?.toLowerCase() ?? active.state}. Wait for it to finish before using manual controls.</p>
          : requiresIntervention ? <p className="mt-1 text-xs text-cocoa">The workflow has stopped and the safety lock remains. Inspect the machine, then clear the intervention lock before resuming sales.</p>
            : !online ? <p className="mt-1 text-xs text-cocoa">The workflow is finished and the lock is clear, but the machine is offline. Restore its power/network connection, use Sync machine, then resume sales here.</p>
              : !statusCurrent ? <p className="mt-1 text-xs text-cocoa">The workflow is finished and the lock is clear. Sync the machine to obtain current hardware status before resuming sales.</p>
                : salesReady ? <p className="mt-1 text-xs font-semibold text-sage">The workflow is finished, the lock is clear, and Huaxin confirms the machine is ready for sales.</p>
                  : <p className="mt-1 text-xs text-cocoa">The workflow is finished and the lock is clear. Sales are still paused; resume them after verifying the machine is physically ready.</p>}
        {!active && !requiresIntervention && !salesReady && <button type="button" onClick={resumeSales} disabled={pending || !safeToResume} className="mt-3 rounded-lg bg-sage px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Resuming..." : "Resume sales"}</button>}
        {!active && !requiresIntervention && !salesReady && !safeToResume && online && statusCurrent && <p className="mt-2 text-[11px] font-semibold text-danger">Resume is blocked until refrigeration is ON, defrost is OFF, and formation is 100%.</p>}
        {safeToResume && <p className="mt-2 text-[11px] text-taupe">The command performs another live safety check before enabling sales.</p>}
      </div>}
      {result && <p className={`mt-2 text-xs font-semibold ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? result.message : result.error}</p>}
      {active && (
        <div className={`mt-4 rounded-lg border px-3 py-3 ${active.state === "recovery" ? "border-danger/40 bg-danger/10" : "border-terracotta/30 bg-white"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-bold text-cocoa">{STATE_LABELS[active.state] ?? active.state}</span><span className="text-[10px] uppercase tracking-wide text-taupe">{active.triggerKind} cycle</span></div>
          <div className="mt-1 text-xs text-taupe">Started {new Date(active.startedAt ?? active.scheduledFor).toLocaleString("en-GB")}{active.lastFormationPct != null ? ` · Formation ${active.lastFormationPct}%` : ""}{active.refrigerationAttempts > 1 ? ` · Fridge attempts ${active.refrigerationAttempts}` : ""}{active.salesAttempts > 1 ? ` · Sales attempts ${active.salesAttempts}` : ""}</div>
          {active.state === "recovery" && <div className="mt-1 text-xs font-semibold text-danger">Sales remain safely blocked while the workflow waits for the cup signal and verifies normal machine state.</div>}
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
