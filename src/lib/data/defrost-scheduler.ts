import { setTimeout as delay } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, getDeviceStatus, sendCommand } from "@/lib/huaxin/client";
import { iceCreamFormationPct } from "@/lib/huaxin/status-signals";
import { recordMachineStatuses } from "@/lib/data/change-log";

type DefrostRun = {
  id: string;
  schedule_id: string;
  machine_id: string;
  state: "scheduled" | "thawing" | "thaw_closed" | "forming" | "recovery";
  next_action_at: string;
  formation_started_at: string | null;
  formation_reset_observed: boolean;
  recovery_attempts: number;
};

type Schedule = { defrost_seconds: number; formation_timeout_seconds: number };
type Machine = { id: string; device_imei: string; name: string; display_name: string | null; deployed: boolean; tenant_id: string | null };

async function updateRun(s: SupabaseClient, run: DefrostRun, owner: string, values: Record<string, unknown>) {
  const { data, error } = await s.from("machine_defrost_runs").update({ ...values, lease_owner: null, lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", run.id).eq("lease_owner", owner).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Defrost run lease was lost before the state could be saved.");
}

async function logCommand(s: SupabaseClient, machine: Machine, command: string, action: string, value: unknown) {
  const { error } = await s.from("machine_change_log").insert({
    machine_id: machine.id,
    device_imei: machine.device_imei,
    machine_name: machine.display_name || machine.name,
    source: "platform",
    action,
    entity_type: "machine",
    entity_key: machine.id,
    field: command,
    new_value: value,
    metadata: { source: "defrost_scheduler" },
  });
  if (error) console.error("[defrost] Could not write command audit:", error);
}

async function issueCommand(s: SupabaseClient, cfg: NonNullable<ReturnType<typeof getConfigFromEnv>>, run: DefrostRun, machine: Machine, step: string, command: string) {
  const { data: existing, error: existingError } = await s.from("machine_command_attempts").select("state,huaxin_code,huaxin_message").eq("run_id", run.id).eq("step", step).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.state === "accepted") return;
  if (existing) throw new Error(`Command ${command} has an unresolved ${existing.state} attempt; automatic retry is blocked.`);
  const { data: attempt, error: insertError } = await s.from("machine_command_attempts").insert({ run_id: run.id, machine_id: machine.id, step, command, state: "sending" }).select("id").single();
  if (insertError || !attempt) throw insertError ?? new Error("Could not record command attempt.");
  try {
    const response = await sendCommand(cfg, machine.device_imei, command);
    const code = String(response.code);
    const message = response.msg ?? "";
    const accepted = code === "200";
    await s.from("machine_command_attempts").update({ state: accepted ? "accepted" : "rejected", huaxin_code: code, huaxin_message: message, updated_at: new Date().toISOString() }).eq("id", attempt.id);
    await logCommand(s, machine, command, accepted ? "scheduled_defrost_command" : "scheduled_defrost_command_failed", { runId: run.id, step, code, message });
    if (!accepted) throw new Error(message || `Huaxin rejected ${command} with code ${code}.`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const { data: saved } = await s.from("machine_command_attempts").select("state").eq("id", attempt.id).single();
    if (saved?.state === "sending") await s.from("machine_command_attempts").update({ state: "ambiguous", error_detail: detail, updated_at: new Date().toISOString() }).eq("id", attempt.id);
    throw error;
  }
}

async function recordFailure(s: SupabaseClient, run: DefrostRun, owner: string, detail: string, state: "recovery" | "failed" | "manual_intervention") {
  const { error } = await s.rpc("record_defrost_failure", { p_run_id: run.id, p_owner: owner, p_detail: detail, p_state: state });
  if (error) throw error;
}

async function safeRecovery(s: SupabaseClient, cfg: NonNullable<ReturnType<typeof getConfigFromEnv>>, run: DefrostRun, machine: Machine) {
  const attempt = run.recovery_attempts + 1;
  const outcomes: string[] = [];
  let safe = true;
  try {
    await issueCommand(s, cfg, run, machine, `recovery_${attempt}_sellout`, "operate_sellout");
    outcomes.push("sales disabled accepted");
  } catch (error) {
    safe = false;
    outcomes.push(`sales disable unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await issueCommand(s, cfg, run, machine, `recovery_${attempt}_thaw_off`, "operate_closethawing");
    outcomes.push("defrost off accepted");
  } catch (error) {
    safe = false;
    outcomes.push(`defrost off unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await delay(5_000);
  try {
    await issueCommand(s, cfg, run, machine, `recovery_${attempt}_refrigeration_on`, "operate_openrefrigeration");
    outcomes.push("refrigeration on accepted");
  } catch (error) {
    safe = false;
    outcomes.push(`refrigeration on unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { safe, detail: outcomes.join("; ") };
}

async function processRun(s: SupabaseClient, cfg: NonNullable<ReturnType<typeof getConfigFromEnv>>, run: DefrostRun, owner: string) {
  const [{ data: schedule, error: scheduleError }, { data: machine, error: machineError }] = await Promise.all([
    s.from("machine_defrost_schedules").select("defrost_seconds,formation_timeout_seconds").eq("id", run.schedule_id).single(),
    s.from("machines").select("id,device_imei,name,display_name,deployed,tenant_id").eq("id", run.machine_id).single(),
  ]);
  if (scheduleError || machineError || !schedule || !machine) throw scheduleError ?? machineError ?? new Error("Defrost run configuration is missing.");
  const typedSchedule = schedule as Schedule;
  const typedMachine = machine as Machine;
  if (!typedMachine.deployed) {
    if (run.state === "scheduled") await recordFailure(s, run, owner, "The machine was undeployed before the scheduled defrost started.", "failed");
    else {
      const recovery = await safeRecovery(s, cfg, run, typedMachine);
      await recordFailure(s, run, owner, `The machine was undeployed during defrost. Safe recovery: ${recovery.detail}.`, recovery.safe ? "manual_intervention" : "recovery");
    }
    return;
  }

  try {
    if (run.state === "recovery") {
      const recovery = await safeRecovery(s, cfg, run, typedMachine);
      await recordFailure(s, run, owner, `Automated safe-state recovery: ${recovery.detail}.`, recovery.safe ? "manual_intervention" : "recovery");
      return;
    }
    if (run.state === "scheduled") {
      await issueCommand(s, cfg, run, typedMachine, "sellout", "operate_sellout");
      await issueCommand(s, cfg, run, typedMachine, "thaw_on", "operate_openthawing");
      await updateRun(s, run, owner, { state: "thawing", started_at: new Date().toISOString(), next_action_at: new Date(Date.now() + typedSchedule.defrost_seconds * 1000).toISOString() });
      return;
    }
    if (run.state === "thawing") {
      await issueCommand(s, cfg, run, typedMachine, "thaw_off", "operate_closethawing");
      const refrigerationAt = new Date(Date.now() + 5_000);
      const { error } = await s.from("machine_defrost_runs").update({ state: "thaw_closed", next_action_at: refrigerationAt.toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id).eq("lease_owner", owner);
      if (error) throw error;
      await delay(5_000);
      run.state = "thaw_closed";
    }
    if (run.state === "thaw_closed") {
      await issueCommand(s, cfg, run, typedMachine, "refrigeration_on", "operate_openrefrigeration");
      const now = new Date();
      const statuses = await getDeviceStatus(cfg, typedMachine.device_imei);
      await recordMachineStatuses(s, typedMachine, statuses);
      const formationPct = statuses.map(iceCreamFormationPct).find((value): value is number => value !== null) ?? null;
      await updateRun(s, run, owner, { state: "forming", formation_started_at: now.toISOString(), formation_reset_observed: formationPct !== null && formationPct < 100, last_formation_pct: formationPct, last_status_observed_at: now.toISOString(), next_action_at: new Date(+now + 60_000).toISOString() });
      return;
    }
    if (run.state === "forming") {
      const statuses = await getDeviceStatus(cfg, typedMachine.device_imei);
      await recordMachineStatuses(s, typedMachine, statuses);
      const formationPct = statuses.map(iceCreamFormationPct).find((value): value is number => value !== null) ?? null;
      const observedAt = new Date().toISOString();
      const resetObserved = run.formation_reset_observed || formationPct !== null && formationPct < 100;
      if (formationPct === 100 && resetObserved) {
        await issueCommand(s, cfg, run, typedMachine, "sales_on", "operate_onsale");
        await updateRun(s, run, owner, { state: "completed", last_formation_pct: formationPct, last_status_observed_at: observedAt, completed_at: observedAt, failure_detail: null });
        return;
      }
      const startedAt = new Date(run.formation_started_at ?? observedAt).getTime();
      if (Date.now() - startedAt >= typedSchedule.formation_timeout_seconds * 1000) {
        await recordFailure(s, run, owner, `Ice cream formation did not reach 100% within ${Math.round(typedSchedule.formation_timeout_seconds / 60)} minutes. Refrigeration is on.`, "failed");
        return;
      }
      await updateRun(s, run, owner, { formation_reset_observed: resetObserved, last_formation_pct: formationPct, last_status_observed_at: observedAt, next_action_at: new Date(Date.now() + 60_000).toISOString() });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const recovery = await safeRecovery(s, cfg, run, typedMachine);
    await recordFailure(s, run, owner, `${detail} Safe recovery: ${recovery.detail}.`, recovery.safe ? "manual_intervention" : "recovery");
  }
}

export async function runDefrostSchedules() {
  const cfg = getConfigFromEnv();
  if (!cfg) throw new Error("Huaxin not configured");
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");
  const s = await createServiceClient();
  const owner = crypto.randomUUID();
  const { data, error } = await s.rpc("claim_due_defrost_runs", { p_owner: owner, p_limit: 10 });
  if (error) throw error;
  const runs = (data as DefrostRun[]) ?? [];
  const results = await Promise.allSettled(runs.map((run) => processRun(s, cfg, run, owner)));
  try {
    const { sendPendingAlertNotifications } = await import("@/lib/data/alert-notifications");
    await sendPendingAlertNotifications(s);
  } catch (error) {
    console.error("[defrost] Alert notification delivery failed:", error);
  }
  return { claimed: runs.length, completed: results.filter((result) => result.status === "fulfilled").length, failed: results.filter((result) => result.status === "rejected").length };
}
