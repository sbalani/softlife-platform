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
  state: "scheduled" | "thawing" | "thaw_closed" | "forming" | "recovery";
  next_action_at: string;
  formation_started_at: string | null;
  formation_reset_observed: boolean;
  recovery_attempts: number;
};
type Schedule = { defrost_seconds: number; formation_timeout_seconds: number };
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

let huaxinSession: { auth: string; jsid: string; at: number } | null = null;

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

async function huaxinRequest(path: string, cfg: HuaxinConfig, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const response = await fetch(cfg.baseUrl.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      mch_id: cfg.mchId,
      mch_secret: cfg.mchSecret,
      nonce_str: cfg.nonceStr,
      time_Stamp: cfg.timeStamp,
      create_ip: "127.0.0.1",
      notify_url: cfg.notifyUrl,
      sign: cfg.sign,
      ...extra,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: Envelope;
  try {
    data = JSON.parse(text) as Envelope;
  } catch {
    throw new Error(`Huaxin ${path} returned HTTP ${response.status} with a non-JSON response`);
  }
  if (!response.ok) throw new Error(`Huaxin ${path} returned HTTP ${response.status}: ${data.msg ?? response.statusText}`);
  return data;
}

async function authorizeHuaxin(cfg: HuaxinConfig) {
  const data = await huaxinRequest("/machine/cloud/api/authorize", cfg);
  if (String(data.code) !== "200") throw new Error(`Huaxin authorize failed: ${data.msg ?? "unknown"}`);
  const auth = (data.data as { authorization?: string } | null)?.authorization;
  if (!auth || !data.jsessionId) throw new Error("Huaxin authorize returned no session");
  huaxinSession = { auth, jsid: data.jsessionId, at: Date.now() };
  return huaxinSession;
}

async function huaxinCall(path: string, cfg: HuaxinConfig, extra: Record<string, unknown>) {
  const session = huaxinSession && Date.now() - huaxinSession.at < 15 * 60_000 ? huaxinSession : await authorizeHuaxin(cfg);
  const headers = { Authorization: session.auth, Cookie: `JSESSIONID=${session.jsid};SESSION=${session.jsid}`, jsessionId: session.jsid };
  const data = await huaxinRequest(path, cfg, extra, headers);
  if (String(data.code) === "208" && (data.msg ?? "").toLowerCase().includes("auth")) {
    const refreshed = await authorizeHuaxin(cfg);
    return huaxinRequest(path, cfg, extra, { Authorization: refreshed.auth, Cookie: `JSESSIONID=${refreshed.jsid};SESSION=${refreshed.jsid}`, jsessionId: refreshed.jsid });
  }
  return data;
}

function sendCommand(cfg: HuaxinConfig, deviceImei: string, command: string) {
  return huaxinCall("/machine/cloud/api/remote/control/data", cfg, {
    device_imei: deviceImei,
    data: { serialNum: String(Date.now()), type: "operate", deviceImei, data: { command, value: "1" } },
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

async function updateRun(s: SupabaseClient, run: DefrostRun, owner: string, values: Record<string, unknown>) {
  const { data, error } = await s.from("machine_defrost_runs").update({ ...values, lease_owner: null, lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", run.id).eq("lease_owner", owner).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Defrost run lease was lost before the state could be saved");
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

async function issueCommand(s: SupabaseClient, cfg: HuaxinConfig, run: DefrostRun, machine: Machine, step: string, command: string) {
  const { data: existing, error: existingError } = await s.from("machine_command_attempts").select("state").eq("run_id", run.id).eq("step", step).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.state === "accepted") return;
  if (existing) throw new Error(`Command ${command} has an unresolved ${existing.state} attempt; automatic retry is blocked`);
  const { data: attempt, error: insertError } = await s.from("machine_command_attempts").insert({ run_id: run.id, machine_id: machine.id, step, command, state: "sending" }).select("id").single();
  if (insertError || !attempt) throw insertError ?? new Error("Could not record command attempt");
  try {
    const response = await sendCommand(cfg, machine.device_imei, command);
    const code = String(response.code);
    const message = response.msg ?? "";
    const accepted = code === "200";
    await s.from("machine_command_attempts").update({ state: accepted ? "accepted" : "rejected", huaxin_code: code, huaxin_message: message, updated_at: new Date().toISOString() }).eq("id", attempt.id);
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
  for (const [step, command, success] of [
    [`recovery_${attempt}_sellout`, "operate_sellout", "sales disabled accepted"],
    [`recovery_${attempt}_thaw_off`, "operate_closethawing", "defrost off accepted"],
  ]) {
    try { await issueCommand(s, cfg, run, machine, step, command); outcomes.push(success); }
    catch (error) { safe = false; outcomes.push(`${command} unconfirmed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  await delay(5_000);
  try { await issueCommand(s, cfg, run, machine, `recovery_${attempt}_refrigeration_on`, "operate_openrefrigeration"); outcomes.push("refrigeration on accepted"); }
  catch (error) { safe = false; outcomes.push(`refrigeration on unconfirmed: ${error instanceof Error ? error.message : String(error)}`); }
  return { safe, detail: outcomes.join("; ") };
}

async function processRun(s: SupabaseClient, cfg: HuaxinConfig, run: DefrostRun, owner: string) {
  const [{ data: schedule, error: scheduleError }, { data: machine, error: machineError }] = await Promise.all([
    s.from("machine_defrost_schedules").select("defrost_seconds,formation_timeout_seconds").eq("id", run.schedule_id).single(),
    s.from("machines").select("id,device_imei,name,display_name,deployed,tenant_id").eq("id", run.machine_id).single(),
  ]);
  if (scheduleError || machineError || !schedule || !machine) throw scheduleError ?? machineError ?? new Error("Defrost configuration is missing");
  const typedSchedule = schedule as Schedule;
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
      await issueCommand(s, cfg, run, typedMachine, "sellout", "operate_sellout");
      await issueCommand(s, cfg, run, typedMachine, "thaw_on", "operate_openthawing");
      await updateRun(s, run, owner, { state: "thawing", started_at: new Date().toISOString(), next_action_at: new Date(Date.now() + typedSchedule.defrost_seconds * 1000).toISOString() });
      return;
    }
    if (run.state === "thawing") {
      await issueCommand(s, cfg, run, typedMachine, "thaw_off", "operate_closethawing");
      const { error } = await s.from("machine_defrost_runs").update({ state: "thaw_closed", next_action_at: new Date(Date.now() + 5_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id).eq("lease_owner", owner);
      if (error) throw error;
      await delay(5_000);
      run.state = "thaw_closed";
    }
    if (run.state === "thaw_closed") {
      await issueCommand(s, cfg, run, typedMachine, "refrigeration_on", "operate_openrefrigeration");
      const now = new Date();
      const statuses = await getDeviceStatus(cfg, typedMachine.device_imei);
      await recordMachineStatuses(s, typedMachine, statuses);
      const pct = statuses.map(formationPct).find((value): value is number => value !== null) ?? null;
      await updateRun(s, run, owner, { state: "forming", formation_started_at: now.toISOString(), formation_reset_observed: pct !== null && pct < 100, last_formation_pct: pct, last_status_observed_at: now.toISOString(), next_action_at: new Date(+now + 60_000).toISOString() });
      return;
    }
    if (run.state === "forming") {
      const statuses = await getDeviceStatus(cfg, typedMachine.device_imei);
      await recordMachineStatuses(s, typedMachine, statuses);
      const pct = statuses.map(formationPct).find((value): value is number => value !== null) ?? null;
      const observedAt = new Date().toISOString();
      const resetObserved = run.formation_reset_observed || pct !== null && pct < 100;
      if (pct === 100 && resetObserved) {
        await issueCommand(s, cfg, run, typedMachine, "sales_on", "operate_onsale");
        await updateRun(s, run, owner, { state: "completed", last_formation_pct: pct, last_status_observed_at: observedAt, completed_at: observedAt, failure_detail: null });
        return;
      }
      const startedAt = new Date(run.formation_started_at ?? observedAt).getTime();
      if (Date.now() - startedAt >= typedSchedule.formation_timeout_seconds * 1000) {
        await recordFailure(s, run, owner, `Ice cream formation did not reach 100% within ${Math.round(typedSchedule.formation_timeout_seconds / 60)} minutes. Refrigeration is on`, "failed");
        return;
      }
      await updateRun(s, run, owner, { formation_reset_observed: resetObserved, last_formation_pct: pct, last_status_observed_at: observedAt, next_action_at: new Date(Date.now() + 60_000).toISOString() });
    }
  } catch (error) {
    const recovery = await safeRecovery(s, cfg, run, typedMachine);
    await recordFailure(s, run, owner, `${error instanceof Error ? error.message : String(error)} Safe recovery: ${recovery.detail}`, recovery.safe ? "manual_intervention" : "recovery");
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
      const machineIds = scope.get(profile.id) ?? [];
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
    const { data: authorized, error: authError } = await s.rpc("verify_defrost_cron_token", { p_token: cronToken });
    if (authError) throw authError;
    if (!authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
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
