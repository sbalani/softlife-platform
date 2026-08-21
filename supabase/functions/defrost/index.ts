import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type HuaxinConfig = {
  baseUrl: string;
  mchId: string;
  mchSecret: string;
  sign: string;
  nonceStr: string;
  timeStamp: string;
  notifyUrl: string;
};

type Envelope = { code?: number; msg?: string; data?: unknown; jsessionId?: string; result?: boolean };
type StatusRow = { code?: string; value?: string; desc?: string; data?: string | number };
type DefrostRun = {
  id: string;
  schedule_id: string;
  machine_id: string;
  state: "scheduled" | "thawing" | "thaw_closed" | "refrigeration_check" | "forming" | "sales_check" | "recovery";
  next_action_at: string;
  formation_started_at: string | null;
  formation_reset_observed: boolean;
  recovery_attempts: number;
  defrost_seconds_snapshot: number;
  formation_timeout_seconds_snapshot: number;
  refrigeration_started_at: string | null;
  refrigeration_attempts: number;
  formation_poll_count: number;
  sales_started_at: string | null;
  sales_attempts: number;
  sales_blocked_observed: boolean;
};
type Machine = { id: string; device_imei: string; name: string; display_name: string | null; deployed: boolean; tenant_id: string | null };
type PushToken = { id: string; user_id: string; expo_push_token: string };
type Profile = { id: string; role: string; tenant_id: string | null };
type AlertRow = { id: string; machine_id: string | null; title: string; message: string; machine_name: string | null };

const RESOURCE_FIELDS: Record<string, string> = {
  status_0_cuplack: "cup_empty",
  status_0_lackmaterial: "material_empty",
};
const FAULT_FIELDS: Record<string, string> = {
  status_0_faultcup: "cup_foreign_object",
  status_0_cupfault: "cup_blocked",
  status_0_cupget: "cup_take_fault",
};
const OPERATING_STATE_FIELDS: Record<string, string> = {
  "8": "material_empty",
  "101": "cup_empty",
  "102": "material_out",
  "104": "cup_take_fault",
  "120": "cup_foreign_object",
  "255": "mixture_ratio_fault",
};
const BENIGN_OPERATING_STATES = new Set(["9", "11", "105"]);
const OPERATING_ACTIONABLE_FIELDS = [...new Set(Object.values(OPERATING_STATE_FIELDS))];
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const COMMAND_DELAY_MS = 2_000;
const POLL_INTERVAL_MS = 60_000;
const CONFIRMATION_TIMEOUT_MS = 10 * 60_000;
const HUAXIN_DEFROST_BRIDGE_URL = "https://softlife-platform.vercel.app/api/internal/huaxin-defrost";

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function huaxinConfig(s: SupabaseClient): Promise<HuaxinConfig> {
  const { data, error } = await s.rpc("get_defrost_huaxin_config");
  if (error) throw error;
  const row = (data as {
    base_url: string;
    mch_id: string;
    mch_secret: string;
    sign: string;
    nonce_str: string;
    time_stamp: string;
    notify_url: string;
  }[] | null)?.[0];
  if (!row?.base_url || !row.mch_id || !row.mch_secret || !row.sign) throw new Error("Huaxin Vault configuration is incomplete");
  return { baseUrl: row.base_url, mchId: row.mch_id, mchSecret: row.mch_secret, sign: row.sign, nonceStr: row.nonce_str, timeStamp: row.time_stamp, notifyUrl: row.notify_url };
}

async function huaxinCall(path: string, _cfg: HuaxinConfig, extra: Record<string, unknown>) {
  const response = await fetch(HUAXIN_DEFROST_BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-defrost-bridge-token": env("HUAXIN_DEFROST_BRIDGE_TOKEN") },
    body: JSON.stringify({ path, extra }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: Envelope & { error?: string };
  try {
    data = JSON.parse(text) as Envelope & { error?: string };
  } catch {
    throw new Error(`Huaxin bridge returned HTTP ${response.status} with a non-JSON response`);
  }
  if (!response.ok) throw new Error(`Huaxin bridge returned HTTP ${response.status}: ${data.error ?? data.msg ?? response.statusText}`);
  return data;
}

function sendCommand(cfg: HuaxinConfig, deviceImei: string, command: string, serialNum: string) {
  return huaxinCall("/machine/cloud/api/remote/control/data", cfg, {
    device_imei: deviceImei,
    data: { serialNum, type: "operate", deviceImei, data: { command, value: "1" } },
  });
}

async function getDeviceStatus(cfg: HuaxinConfig, deviceImei: string): Promise<StatusRow[]> {
  const data = await huaxinCall("/machine/cloud/api/device/configure/status/detail", cfg, { device_imei: deviceImei });
  return (data.data as StatusRow[] | null) ?? [];
}

function operatingStatusSignals(row: StatusRow) {
  if (row.code !== "status_0_os") return [];
  const value = String(row.value ?? row.data ?? "").trim();
  const normalized = value.toLowerCase();
  const stateCode = value.match(/^\[(\d+)]/)?.[1];
  const cleared = OPERATING_ACTIONABLE_FIELDS.map((field) => ({ field, value: false, raw: row }));
  if (!value || ["0", "false", "normal", "none", "close", "closed", "off", "cierre", "正常", "无", "关"].includes(normalized)) {
    return [{ field: "ordering_system_fault", value: false, raw: row }, ...cleared];
  }
  const specificField = stateCode && OPERATING_STATE_FIELDS[stateCode];
  if (specificField) return [{ field: "ordering_system_fault", value: false, raw: row }, ...cleared.map((signal) => signal.field === specificField ? { ...signal, value: true } : signal)];
  if (stateCode && BENIGN_OPERATING_STATES.has(stateCode)) return [{ field: "ordering_system_fault", value: false, raw: row }, ...cleared];
  return [{ field: "ordering_system_fault", value: true, raw: row }, ...cleared];
}

function statusSignals(rows: StatusRow[]) {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const signals = new Map<string, { field: string; value: boolean | number; raw: StatusRow }>();
  const set = (field: string, value: boolean | number, raw: StatusRow) => {
    const existing = signals.get(field);
    if (existing?.value === true && value === false) return;
    signals.set(field, { field, value, raw });
  };
  for (const row of byCode.values()) {
    if (!row.code) continue;
    const resourceField = RESOURCE_FIELDS[row.code];
    if (resourceField) {
      const value = String(row.value ?? "").trim().toLowerCase();
      const inactive = ["0", "false", "normal", "none", "available", "正常", "无"].includes(value);
      const active = ["1", "true", "abnormal", "anomaly", "anomalies", "anomalía", "anomalías", "anomalia", "anomalias", "starts lacking material", "liquid level low", "comienza a faltar material"].includes(value);
      const numericData = Number(String(row.data ?? "").trim());
      set(resourceField, inactive ? false : active || (!value && Number.isFinite(numericData) && numericData > 0), row);
    }
    if (row.code === "status_0_os") {
      for (const signal of operatingStatusSignals(row)) set(signal.field, signal.value, row);
      continue;
    }
    const faultField = FAULT_FIELDS[row.code];
    if (faultField) {
      const value = String(row.value ?? row.data ?? "").trim().toLowerCase();
      set(faultField, Boolean(value) && !["0", "false", "normal", "none", "close", "closed", "off", "cierre", "正常", "无", "关"].includes(value), row);
    }
  }
  const online = byCode.get("status_0_online_status");
  if (online) set("device_online", String(online.value).toLowerCase() === "online", online);
  const material = byCode.get("status_0_sellcup");
  if (material) {
    const normal = String(material.value ?? "").trim().match(/^normal\s*\[\s*(\d+)\s*]$/i);
    const counter = [material.value, material.data].map(String).find((value) => /\d+\s*\[\s*\d+\s*]/.test(value));
    const match = counter?.match(/(\d+)\s*\[\s*(\d+)\s*]/);
    if (normal && Number(normal[1]) > 0) {
      set("material_remaining_pct", 100, material);
      set("material_out", false, material);
    } else if (match && Number(match[2]) > 0) {
      const remaining = Number(match[1]);
      set("material_remaining_pct", Math.max(0, Math.min(100, Math.floor(remaining / Number(match[2]) * 100))), material);
      set("material_out", remaining === 0, material);
    }
  }
  return [...signals.values()];
}

async function recordMachineStatuses(s: SupabaseClient, machine: Machine, rows: StatusRow[]) {
  const signals = statusSignals(rows);
  const { data: saved, error: readError } = await s.from("machine_status_snapshots").select("field,value").eq("machine_id", machine.id);
  if (readError) throw readError;
  const previous = new Map(((saved as { field: string; value: unknown }[]) ?? []).map((row) => [row.field, row.value]));
  if (signals.length) {
    const { error } = await s.from("machine_change_log").insert(signals.map((signal) => ({
      machine_id: machine.id,
      device_imei: machine.device_imei,
      machine_name: machine.display_name || machine.name,
      source: "machine_sync",
      action: previous.has(signal.field) && previous.get(signal.field) !== signal.value ? "status_changed" : "observed",
      entity_type: "machine_status",
      entity_key: signal.field,
      field: signal.field,
      old_value: previous.get(signal.field) ?? null,
      new_value: signal.value,
      metadata: { description: signal.raw.desc, raw_value: signal.raw.value, raw_data: signal.raw.data },
    })));
    if (error) throw error;
  }
  const observedAt = new Date().toISOString();
  const rawSnapshots = [...new Map(rows.map((row, index) => {
    const field = `raw:${row.code ?? index}`;
    return [field, { machine_id: machine.id, field, value: row.value ?? row.data ?? "", raw: row, observed_at: observedAt }];
  })).values()];
  const snapshots = [
    ...signals.map((signal) => ({ machine_id: machine.id, field: signal.field, value: signal.value, raw: signal.raw, observed_at: observedAt })),
    ...rawSnapshots,
  ];
  if (snapshots.length) {
    const { error } = await s.from("machine_status_snapshots").upsert(snapshots, { onConflict: "machine_id,field" });
    if (error) throw error;
  }
  const currentRaw = new Set(rawSnapshots.map((row) => row.field));
  const staleRaw = ((saved as { field: string }[]) ?? []).filter((row) => row.field.startsWith("raw:") && !currentRaw.has(row.field)).map((row) => row.field);
  if (staleRaw.length) await s.from("machine_status_snapshots").delete().eq("machine_id", machine.id).in("field", staleRaw);
}

function formationPct(row: StatusRow) {
  if (row.code !== "status_0_percent") return null;
  const value = Number(String(row.value ?? row.data ?? "").trim().replace(/%$/, ""));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function statusValue(rows: StatusRow[], code: string) {
  const row = rows.find((status) => status.code === code);
  return row == null ? null : String(row.value ?? row.data ?? "").trim();
}

function normalizedStatus(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function isOpen(value: string | null) {
  return ["abrir", "open", "on", "开"].includes(normalizedStatus(value));
}

function isClosed(value: string | null) {
  return ["cierre", "close", "closed", "off", "关"].includes(normalizedStatus(value));
}

function operatingStateCode(value: string | null) {
  return value?.match(/^\[(\d+)]/)?.[1] ?? null;
}

function isSalesBlocked(value: string | null) {
  return ["4", "9", "105"].includes(operatingStateCode(value) ?? "");
}

function isSalesReady(value: string | null) {
  const normalized = normalizedStatus(value);
  return normalized === "normal" || operatingStateCode(value) === "11";
}

async function appendEvent(s: SupabaseClient, run: DefrostRun, eventKey: string, eventType: string, detail: Record<string, unknown> = {}, stateBefore?: string, stateAfter?: string) {
  const { error } = await s.rpc("append_defrost_event", {
    p_run_id: run.id,
    p_event_key: eventKey,
    p_event_type: eventType,
    p_state_before: stateBefore ?? null,
    p_state_after: stateAfter ?? null,
    p_actor_id: null,
    p_detail: detail,
  });
  if (error) throw error;
}

async function captureTelemetry(s: SupabaseClient, cfg: HuaxinConfig, run: DefrostRun, machine: Machine, checkpoint: string, pollNumber: number) {
  const statuses = await getDeviceStatus(cfg, machine.device_imei);
  await recordMachineStatuses(s, machine, statuses);
  const observedAt = new Date().toISOString();
  const pct = statuses.map(formationPct).find((value): value is number => value !== null) ?? null;
  const values = {
    refrigeration: statusValue(statuses, "status_0_ac"),
    defrost: statusValue(statuses, "status_0_thaw"),
    formation: pct,
    sales: statusValue(statuses, "status_0_stock"),
    operating: statusValue(statuses, "status_0_os"),
  };
  const { error } = await s.from("machine_defrost_telemetry").insert({
    run_id: run.id,
    machine_id: machine.id,
    checkpoint,
    poll_number: pollNumber,
    refrigeration_value: values.refrigeration,
    defrost_value: values.defrost,
    formation_pct: values.formation,
    sales_value: values.sales,
    operating_value: values.operating,
    raw_status: statuses,
    observed_at: observedAt,
  });
  if (error) throw error;
  await appendEvent(s, run, `${checkpoint}_${pollNumber}_${crypto.randomUUID()}`, "telemetry_observed", { ...values, observed_at: observedAt });
  return { statuses, observedAt, ...values };
}

async function transitionRun(s: SupabaseClient, run: DefrostRun, owner: string, nextState: string, eventKey: string, values: Record<string, unknown> = {}, releaseLease = true) {
  const previousState = run.state;
  const { error } = await s.rpc("transition_defrost_run", {
    p_run_id: run.id, p_owner: owner, p_expected_state: previousState, p_next_state: nextState,
    p_event_key: eventKey, p_values: values, p_release_lease: releaseLease,
  });
  if (error) throw error;
}

async function confirmCommandEffect(s: SupabaseClient, run: DefrostRun, command: string, observedAt: string) {
  const { data, error } = await s.from("machine_command_attempts").select("id").eq("run_id", run.id).eq("command", command).eq("state", "accepted").order("attempt_number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (data) {
    const { error: updateError } = await s.from("machine_command_attempts").update({ effect_confirmed_at: observedAt, updated_at: new Date().toISOString() }).eq("id", data.id);
    if (updateError) throw updateError;
  }
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
    metadata: { source: "supabase_defrost_scheduler" },
  });
  if (error) console.error("[defrost] Command audit failed", error);
}

async function issueCommand(s: SupabaseClient, cfg: HuaxinConfig, run: DefrostRun, machine: Machine, step: string, command: string, attemptNumber = 1) {
  const { data: existing, error: existingError } = await s.from("machine_command_attempts").select("state").eq("run_id", run.id).eq("step", step).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.state === "accepted") return;
  if (existing) throw new Error(`Command ${command} has an unresolved ${existing.state} attempt; automatic retry is blocked`);
  const providerSerial = String(Date.now());
  const { data: attempt, error: insertError } = await s.from("machine_command_attempts").insert({ run_id: run.id, machine_id: machine.id, step, command, state: "sending", attempt_number: attemptNumber, provider_serial: providerSerial }).select("id").single();
  if (insertError || !attempt) throw insertError ?? new Error("Could not record command attempt");
  await appendEvent(s, run, `command_${step}_started`, "command_send_started", { command, attempt_number: attemptNumber, attempt_id: attempt.id });
  try {
    const response = await sendCommand(cfg, machine.device_imei, command, providerSerial);
    const code = String(response.code);
    const message = response.msg ?? "";
    const accepted = code === "200";
    const { error: updateError } = await s.from("machine_command_attempts").update({ state: accepted ? "accepted" : "rejected", huaxin_code: code, huaxin_message: message, response_received_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", attempt.id);
    if (updateError) throw updateError;
    await appendEvent(s, run, `command_${step}_result`, accepted ? "command_accepted" : "command_rejected", { command, attempt_number: attemptNumber, attempt_id: attempt.id, code, message });
    await logCommand(s, machine, command, accepted ? "scheduled_defrost_command" : "scheduled_defrost_command_failed", { runId: run.id, step, code, message });
    if (!accepted) throw new Error(message || `Huaxin rejected ${command} with code ${code}`);
  } catch (error) {
    const { data: saved } = await s.from("machine_command_attempts").select("state").eq("id", attempt.id).single();
    if (saved?.state === "sending") await s.from("machine_command_attempts").update({ state: "ambiguous", error_detail: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", attempt.id);
    throw error;
  }
}

async function recordFailure(s: SupabaseClient, run: DefrostRun, owner: string, detail: string, state: "recovery" | "failed" | "manual_intervention") {
  const { error } = await s.rpc("record_defrost_failure", { p_run_id: run.id, p_owner: owner, p_detail: detail, p_state: state });
  if (error) throw error;
}

async function safeRecovery(s: SupabaseClient, cfg: HuaxinConfig, run: DefrostRun, machine: Machine) {
  const attempt = run.recovery_attempts + 1;
  const outcomes: string[] = [];
  let safe = true;
  try { await issueCommand(s, cfg, run, machine, `recovery_${attempt}_sellout`, "operate_sellout", attempt); outcomes.push("sales disabled accepted"); }
  catch (error) { safe = false; outcomes.push(`operate_sellout unconfirmed: ${error instanceof Error ? error.message : String(error)}`); }
  await delay(COMMAND_DELAY_MS);
  try { await issueCommand(s, cfg, run, machine, `recovery_${attempt}_thaw_off`, "operate_closethawing", attempt); outcomes.push("defrost off accepted"); }
  catch (error) { safe = false; outcomes.push(`operate_closethawing unconfirmed: ${error instanceof Error ? error.message : String(error)}`); }
  await delay(COMMAND_DELAY_MS);
  try { await issueCommand(s, cfg, run, machine, `recovery_${attempt}_refrigeration_on`, "operate_openrefrigeration"); outcomes.push("refrigeration on accepted"); }
  catch (error) { safe = false; outcomes.push(`refrigeration on unconfirmed: ${error instanceof Error ? error.message : String(error)}`); }
  await delay(COMMAND_DELAY_MS);
  try {
    const telemetry = await captureTelemetry(s, cfg, run, machine, "recovery", attempt);
    const blocked = isSalesBlocked(telemetry.operating) || !isOpen(telemetry.sales);
    if (!isOpen(telemetry.refrigeration)) { safe = false; outcomes.push(`refrigeration state is ${telemetry.refrigeration ?? "missing"}`); }
    else if (!isClosed(telemetry.defrost)) { safe = false; outcomes.push(`defrost state is ${telemetry.defrost ?? "missing"}`); }
    else if (!blocked) { safe = false; outcomes.push(`sales-disabled state is unconfirmed (${telemetry.operating ?? "missing"})`); }
    else outcomes.push(`refrigeration confirmed ${telemetry.refrigeration}`);
  } catch (error) { safe = false; outcomes.push(`recovery telemetry failed: ${error instanceof Error ? error.message : String(error)}`); }
  return { safe, detail: outcomes.join("; ") };
}

async function processRun(s: SupabaseClient, cfg: HuaxinConfig, run: DefrostRun, owner: string) {
  const { data: machine, error: machineError } = await s.from("machines").select("id,device_imei,name,display_name,deployed,tenant_id").eq("id", run.machine_id).single();
  if (machineError || !machine) throw machineError ?? new Error("Defrost machine is missing");
  const typedMachine = machine as Machine;
  if (!typedMachine.deployed) {
    if (run.state === "scheduled") await recordFailure(s, run, owner, "The machine was undeployed before scheduled defrost started", "failed");
    else {
      const recovery = await safeRecovery(s, cfg, run, typedMachine);
      await recordFailure(s, run, owner, `The machine was undeployed during defrost. Safe recovery: ${recovery.detail}`, recovery.safe ? "manual_intervention" : "recovery");
    }
    return;
  }
  try {
    if (run.state === "recovery") {
      const recovery = await safeRecovery(s, cfg, run, typedMachine);
      await recordFailure(s, run, owner, `Automated safe-state recovery: ${recovery.detail}`, recovery.safe ? "manual_intervention" : "recovery");
      return;
    }
    if (run.state === "scheduled") {
      const telemetry = await captureTelemetry(s, cfg, run, typedMachine, "precheck", 0);
      if (normalizedStatus(statusValue(telemetry.statuses, "status_0_online_status")) !== "online") throw new Error("Machine is not online at defrost precheck");
      await appendEvent(s, run, "precheck_passed", "precheck_passed", { refrigeration: telemetry.refrigeration, defrost: telemetry.defrost, formation: telemetry.formation, sales: telemetry.sales });
      await issueCommand(s, cfg, run, typedMachine, "sellout", "operate_sellout");
      await appendEvent(s, run, "delay_after_sellout", "command_delay", { milliseconds: COMMAND_DELAY_MS });
      await delay(COMMAND_DELAY_MS);
      await issueCommand(s, cfg, run, typedMachine, "refrigeration_off", "operate_closerefrigeration");
      await appendEvent(s, run, "delay_after_refrigeration_off", "command_delay", { milliseconds: COMMAND_DELAY_MS });
      await delay(COMMAND_DELAY_MS);
      await issueCommand(s, cfg, run, typedMachine, "thaw_on", "operate_openthawing");
      await transitionRun(s, run, owner, "thawing", "defrost_started", { started_at: new Date().toISOString(), next_action_at: new Date(Date.now() + run.defrost_seconds_snapshot * 1000).toISOString() });
      return;
    }
    if (run.state === "thawing") {
      await issueCommand(s, cfg, run, typedMachine, "thaw_off", "operate_closethawing");
      await transitionRun(s, run, owner, "thaw_closed", "defrost_stopped", { next_action_at: new Date(Date.now() + COMMAND_DELAY_MS).toISOString(), milliseconds_until_refrigeration: COMMAND_DELAY_MS }, false);
      await delay(COMMAND_DELAY_MS);
      run.state = "thaw_closed";
    }
    if (run.state === "thaw_closed") {
      const stoppedTelemetry = await captureTelemetry(s, cfg, run, typedMachine, "before_refrigeration_on", 0);
      if (isClosed(stoppedTelemetry.defrost)) await confirmCommandEffect(s, run, "operate_closethawing", stoppedTelemetry.observedAt);
      const salesBlockedObserved = run.sales_blocked_observed || isSalesBlocked(stoppedTelemetry.operating) || !isOpen(stoppedTelemetry.sales);
      await issueCommand(s, cfg, run, typedMachine, "refrigeration_on_1", "operate_openrefrigeration", 1);
      const now = new Date();
      await transitionRun(s, run, owner, "refrigeration_check", "refrigeration_requested", { refrigeration_started_at: now.toISOString(), refrigeration_attempts: 1, sales_blocked_observed: salesBlockedObserved, next_action_at: new Date(+now + POLL_INTERVAL_MS).toISOString() });
      return;
    }
    if (run.state === "refrigeration_check") {
      const poll = Math.max(run.refrigeration_attempts, 1);
      const telemetry = await captureTelemetry(s, cfg, run, typedMachine, "refrigeration_check", poll);
      const salesBlockedObserved = run.sales_blocked_observed || isSalesBlocked(telemetry.operating) || !isOpen(telemetry.sales);
      if (isOpen(telemetry.refrigeration) && isClosed(telemetry.defrost)) {
        await confirmCommandEffect(s, run, "operate_closethawing", telemetry.observedAt);
        await confirmCommandEffect(s, run, "operate_openrefrigeration", telemetry.observedAt);
        const resetObserved = telemetry.formation !== null && telemetry.formation < 100;
        await transitionRun(s, run, owner, "forming", "refrigeration_confirmed", { formation_started_at: telemetry.observedAt, formation_reset_observed: resetObserved, formation_poll_count: 0, sales_blocked_observed: salesBlockedObserved, last_formation_pct: telemetry.formation, last_status_observed_at: telemetry.observedAt, final_refrigeration_value: telemetry.refrigeration, next_action_at: new Date(Date.now() + POLL_INTERVAL_MS).toISOString() });
        return;
      }
      const startedAt = new Date(run.refrigeration_started_at ?? telemetry.observedAt).getTime();
      if (Date.now() - startedAt >= CONFIRMATION_TIMEOUT_MS || run.refrigeration_attempts >= 10) throw new Error("Defrost off and refrigeration on could not both be confirmed within 10 minutes");
      const nextAttempt = run.refrigeration_attempts + 1;
      if (!isClosed(telemetry.defrost)) {
        await issueCommand(s, cfg, run, typedMachine, `thaw_off_confirm_${nextAttempt}`, "operate_closethawing", nextAttempt);
        await delay(COMMAND_DELAY_MS);
      }
      await issueCommand(s, cfg, run, typedMachine, `refrigeration_on_${nextAttempt}`, "operate_openrefrigeration", nextAttempt);
      await transitionRun(s, run, owner, "refrigeration_check", `refrigeration_retry_${nextAttempt}`, { refrigeration_attempts: nextAttempt, sales_blocked_observed: salesBlockedObserved, last_status_observed_at: telemetry.observedAt, final_refrigeration_value: telemetry.refrigeration, next_action_at: new Date(Date.now() + POLL_INTERVAL_MS).toISOString() });
      return;
    }
    if (run.state === "forming") {
      const poll = run.formation_poll_count + 1;
      const telemetry = await captureTelemetry(s, cfg, run, typedMachine, "formation", poll);
      const pct = telemetry.formation;
      const observedAt = telemetry.observedAt;
      const resetObserved = run.formation_reset_observed || pct !== null && pct < 100;
      const salesBlockedObserved = run.sales_blocked_observed || isSalesBlocked(telemetry.operating) || !isOpen(telemetry.sales);
      if (pct === 100 && resetObserved) {
        await issueCommand(s, cfg, run, typedMachine, "sales_on_1", "operate_onsale", 1);
        await transitionRun(s, run, owner, "sales_check", "sales_requested", { sales_started_at: observedAt, sales_attempts: 1, sales_blocked_observed: salesBlockedObserved, formation_poll_count: poll, last_formation_pct: pct, last_status_observed_at: observedAt, next_action_at: new Date(Date.now() + POLL_INTERVAL_MS).toISOString() });
        return;
      }
      const startedAt = new Date(run.formation_started_at ?? observedAt).getTime();
      if (Date.now() - startedAt >= run.formation_timeout_seconds_snapshot * 1000) throw new Error(`Ice cream formation did not reach 100% within ${Math.round(run.formation_timeout_seconds_snapshot / 60)} minutes`);
      await transitionRun(s, run, owner, "forming", `formation_poll_${poll}`, { formation_reset_observed: resetObserved, formation_poll_count: poll, sales_blocked_observed: salesBlockedObserved, last_formation_pct: pct, last_status_observed_at: observedAt, next_action_at: new Date(Date.now() + POLL_INTERVAL_MS).toISOString() });
      return;
    }
    if (run.state === "sales_check") {
      const poll = Math.max(run.sales_attempts, 1);
      const telemetry = await captureTelemetry(s, cfg, run, typedMachine, "sales_check", poll);
      if (run.sales_blocked_observed && isSalesReady(telemetry.operating) && isOpen(telemetry.sales)) {
        await confirmCommandEffect(s, run, "operate_onsale", telemetry.observedAt);
        await transitionRun(s, run, owner, "completed", "cycle_completed", { completed_at: telemetry.observedAt, outcome: "completed", final_sales_value: `${telemetry.operating} / ${telemetry.sales}`, failure_detail: null });
        return;
      }
      const startedAt = new Date(run.sales_started_at ?? telemetry.observedAt).getTime();
      if (Date.now() - startedAt >= CONFIRMATION_TIMEOUT_MS || run.sales_attempts >= 10) throw new Error(`Sales resumption could not be confirmed within 10 minutes (blocked state observed: ${run.sales_blocked_observed ? "yes" : "no"}, operating state: ${telemetry.operating ?? "missing"})`);
      const nextAttempt = run.sales_attempts + 1;
      await issueCommand(s, cfg, run, typedMachine, `sales_on_${nextAttempt}`, "operate_onsale", nextAttempt);
      await transitionRun(s, run, owner, "sales_check", `sales_retry_${nextAttempt}`, { sales_attempts: nextAttempt, final_sales_value: telemetry.operating, last_status_observed_at: telemetry.observedAt, next_action_at: new Date(Date.now() + POLL_INTERVAL_MS).toISOString() });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (run.state === "scheduled") {
      const { count, error: attemptsError } = await s.from("machine_command_attempts").select("id", { count: "exact", head: true }).eq("run_id", run.id);
      if (attemptsError) throw attemptsError;
      if (count === 0) {
        const completedAt = new Date().toISOString();
        await transitionRun(s, run, owner, "failed", "precheck_failed", { completed_at: completedAt, outcome: "failed", failure_detail: detail });
        return;
      }
    }
    const recovery = await safeRecovery(s, cfg, run, typedMachine);
    await recordFailure(s, run, owner, `${detail} Safe recovery: ${recovery.detail}`, recovery.safe ? "manual_intervention" : "recovery");
  }
}

function madridDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function machineIdsForProfile(s: SupabaseClient, profile: Profile): Promise<string[] | null> {
  if (profile.role === "admin") return null;
  if (profile.role === "operator") {
    const now = new Date().toISOString();
    const { data } = await s.from("user_machine_assignments").select("machine_id").eq("user_id", profile.id).lte("starts_at", now).or(`ends_at.is.null,ends_at.gte.${now}`);
    const ids = [...new Set(((data as { machine_id: string }[]) ?? []).map((row) => row.machine_id))];
    if (!ids.length) return [];
    const { data: machines } = await s.from("machines").select("id").in("id", ids).eq("deployed", true);
    return ((machines as { id: string }[]) ?? []).map((row) => row.id);
  }
  if (profile.role !== "franchisee" || !profile.tenant_id) return [];
  const day = madridDay();
  const { data } = await s.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date").lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`).order("start_date", { ascending: false });
  const effective = new Map<string, string>();
  for (const row of (data as { machine_id: string; tenant_id: string }[]) ?? []) if (!effective.has(row.machine_id)) effective.set(row.machine_id, row.tenant_id);
  const ids = [...effective].filter(([, tenantId]) => tenantId === profile.tenant_id).map(([machineId]) => machineId);
  if (!ids.length) return [];
  const { data: machines } = await s.from("machines").select("id").in("id", ids).eq("deployed", true);
  return ((machines as { id: string }[]) ?? []).map((row) => row.id);
}

async function sendPendingAlertNotifications(s: SupabaseClient) {
  const { data: tokenRows, error: tokenError } = await s.from("mobile_push_tokens").select("id,user_id,expo_push_token");
  if (tokenError) throw tokenError;
  const tokens = (tokenRows as PushToken[]) ?? [];
  if (!tokens.length) return 0;
  const { data: alertRows, error: alertError } = await s.rpc("claim_pending_alert_pushes", { p_limit: 50 });
  if (alertError) throw alertError;
  const alerts = (alertRows as AlertRow[]) ?? [];
  if (!alerts.length) return 0;
  const { data: profileRows, error: profileError } = await s.from("profiles").select("id,role,tenant_id").in("id", [...new Set(tokens.map((token) => token.user_id))]);
  if (profileError) throw profileError;
  const profiles = new Map(((profileRows as Profile[]) ?? []).map((profile) => [profile.id, profile]));
  const scope = new Map<string, string[] | null>();
  for (const profile of profiles.values()) scope.set(profile.id, await machineIdsForProfile(s, profile));
  let sent = 0;
  for (const alert of alerts) {
    const eligible = tokens.filter((token) => {
      const profile = profiles.get(token.user_id);
      if (!profile) return false;
      const machineIds = scope.get(profile.id);
      if (machineIds === undefined) return false;
      return alert.machine_id ? machineIds === null || machineIds.includes(alert.machine_id) : profile.role === "admin";
    });
    if (!eligible.length) { await s.from("alerts").update({ push_claimed_at: null }).eq("id", alert.id); continue; }
    try {
      let accepted = 0;
      for (let offset = 0; offset < eligible.length; offset += 100) {
        const chunk = eligible.slice(offset, offset + 100);
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(Deno.env.get("EXPO_ACCESS_TOKEN") ? { Authorization: `Bearer ${Deno.env.get("EXPO_ACCESS_TOKEN")}` } : {}),
          },
          body: JSON.stringify(chunk.map((token) => ({ to: token.expo_push_token, sound: "default", title: `${alert.title} · ${alert.machine_name || "Machine alert"}`, body: alert.message, data: { machineId: alert.machine_id, alertId: alert.id }, channelId: "machine-alerts" }))),
        });
        if (!response.ok) throw new Error(`Expo push failed: ${response.status}`);
        const tickets = ((await response.json()) as { data?: { status?: string; details?: { error?: string } }[] }).data ?? [];
        for (let index = 0; index < chunk.length; index++) {
          if (tickets[index]?.status === "ok") accepted++;
          else if (tickets[index]?.details?.error === "DeviceNotRegistered") await s.from("mobile_push_tokens").delete().eq("id", chunk[index].id);
        }
      }
      if (!accepted) throw new Error("No device accepted the notification");
      await s.from("alerts").update({ push_notified_at: new Date().toISOString(), push_claimed_at: null }).eq("id", alert.id);
      sent += accepted;
    } catch (error) {
      console.error("[defrost] Push delivery failed", alert.id, error);
      await s.from("alerts").update({ push_claimed_at: null }).eq("id", alert.id);
    }
  }
  return sent;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  try {
    const s = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const cronToken = request.headers.get("x-cron-token") ?? "";
    const { data: cronAuthorized, error: authError } = await s.rpc("verify_defrost_cron_token", { p_token: cronToken });
    if (authError) throw authError;
    if (!cronAuthorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const cfg = await huaxinConfig(s);
    const owner = crypto.randomUUID();
    const { data, error } = await s.rpc("claim_due_defrost_runs", { p_owner: owner, p_limit: 10 });
    if (error) throw error;
    const runs = (data as DefrostRun[]) ?? [];
    const results = await Promise.allSettled(runs.map((run) => processRun(s, cfg, run, owner)));
    let notifications = 0;
    try { notifications = await sendPendingAlertNotifications(s); }
    catch (error) { console.error("[defrost] Alert notification delivery failed", error); }
    return Response.json({ claimed: runs.length, completed: results.filter((result) => result.status === "fulfilled").length, failed: results.filter((result) => result.status === "rejected").length, notifications });
  } catch (error) {
    console.error("[defrost] Worker failed", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
