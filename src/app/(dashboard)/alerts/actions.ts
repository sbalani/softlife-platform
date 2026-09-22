"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { canAccessMachine } from "@/lib/data/service-access";

export type AlertRuleResult = { ok: boolean; error?: string };

const NUMERIC_FIELDS = new Set(["price", "marketPrice", "stock", "temperature"]);
const STATUS_FIELDS = new Set(["cup_empty", "material_empty", "device_online", "cup_foreign_object", "ordering_system_fault", "cup_blocked", "cup_take_fault", "mixture_ratio_fault"]);
const PRODUCT_FIELDS = new Set(["price", "marketPrice", "stock"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

export async function dismissAlert(alertId: string): Promise<AlertRuleResult> {
  if (!UUID.test(alertId)) return { ok: false, error: "Invalid alert." };
  const actor = await getSessionProfile();
  if (!actor || !["admin", "franchisee"].includes(actor.role)) return { ok: false, error: "Access denied." };
  const s = await createServiceClient();
  const { data: alert, error: alertError } = await s.from("alerts").select("id,machine_id,resolved_at").eq("id", alertId).maybeSingle();
  if (alertError) return { ok: false, error: alertError.message };
  if (!alert) return { ok: false, error: "Alert not found." };
  if (alert.machine_id) {
    if (!await canAccessMachine(s, actor, alert.machine_id, new Date().toISOString())) return { ok: false, error: "Access denied." };
  } else if (actor.role !== "admin") return { ok: false, error: "Access denied." };
  if (alert.resolved_at) return { ok: true };

  const now = new Date().toISOString();
  const { data: dismissed, error } = await s.from("alerts").update({ resolved_at: now, resolved_by: actor.id }).eq("id", alertId).is("resolved_at", null).select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!dismissed) return { ok: true };
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
  if (alert.machine_id) {
    const { data: machine } = await s.from("machines").select("device_imei").eq("id", alert.machine_id).maybeSingle();
    if (machine?.device_imei) revalidatePath(`/machines/${machine.device_imei}`);
  }
  return { ok: true };
}

export async function saveAlertRule(_previous: AlertRuleResult | null, formData: FormData): Promise<AlertRuleResult> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, error: "Access denied." };
  const name = String(formData.get("name") ?? "").trim();
  const field = String(formData.get("field") ?? "");
  const minRaw = String(formData.get("min_value") ?? "").trim();
  const maxRaw = String(formData.get("max_value") ?? "").trim();
  const minValue = minRaw === "" ? null : Number(minRaw);
  const maxValue = maxRaw === "" ? null : Number(maxRaw);
  const severity = String(formData.get("severity") ?? "warning");
  const machineId = String(formData.get("machine_id") ?? "") || null;
  const productId = String(formData.get("product_id") ?? "") || null;
  const seriesName = field === "temperature" ? String(formData.get("series_name") ?? "").trim() || null : null;
  const notifyMobile = formData.get("notify_mobile") === "on";
  const ruleType = STATUS_FIELDS.has(field) ? "status_equals" : "numeric_range";
  const targetValue = ruleType === "status_equals" ? String(formData.get("target_value") ?? "") : null;
  if (!name) return { ok: false, error: "Rule name is required." };
  if (!NUMERIC_FIELDS.has(field) && !STATUS_FIELDS.has(field)) return { ok: false, error: "Unsupported field." };
  if (ruleType === "numeric_range" && minValue === null && maxValue === null) return { ok: false, error: "Set a minimum, maximum, or both." };
  if (ruleType === "numeric_range" && ((minValue !== null && !Number.isFinite(minValue)) || (maxValue !== null && !Number.isFinite(maxValue)))) return { ok: false, error: "Limits must be numbers." };
  if (ruleType === "numeric_range" && minValue !== null && maxValue !== null && minValue > maxValue) return { ok: false, error: "Minimum cannot exceed maximum." };
  if (ruleType === "status_equals" && !new Set(["true", "false"]).has(targetValue ?? "")) return { ok: false, error: "Select a status." };
  if (productId && !PRODUCT_FIELDS.has(field)) return { ok: false, error: "Product scope only applies to price and stock fields." };
  if (!new Set(["info", "warning", "critical"]).has(severity)) return { ok: false, error: "Invalid severity." };

  const s = await createServiceClient();
  if (machineId) {
    const { data } = await s.from("machines").select("id").eq("id", machineId).maybeSingle();
    if (!data) return { ok: false, error: "Machine not found." };
  }
  if (productId) {
    const { data } = await s.from("products").select("id").eq("id", productId).maybeSingle();
    if (!data) return { ok: false, error: "Product not found." };
  }
  const { error } = await s.from("change_alert_rules").insert({
    name,
    field,
    machine_id: machineId,
    product_id: productId,
    rule_type: ruleType,
    min_value: ruleType === "numeric_range" ? minValue : null,
    max_value: ruleType === "numeric_range" ? maxValue : null,
    target_value: targetValue,
    severity,
    series_name: seriesName,
    notify_mobile: notifyMobile,
    created_by: session.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/alerts");
  return { ok: true };
}

export async function setAlertRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") throw new Error("Access denied.");
  const s = await createServiceClient();
  const { error } = await s.from("change_alert_rules").update({ enabled }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}

export async function setAlertRuleMobileNotification(id: string, notifyMobile: boolean): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") throw new Error("Access denied.");
  const s = await createServiceClient();
  const { error } = await s.from("change_alert_rules").update({ notify_mobile: notifyMobile }).eq("id", id);
  if (error) throw new Error(error.message);
  const { error: alertError } = await s.from("alerts").update({ mobile_notification: notifyMobile, ...(notifyMobile ? { push_notified_at: null, push_claimed_at: null } : {}) }).eq("change_alert_rule_id", id).is("resolved_at", null);
  if (alertError) throw new Error(alertError.message);
  revalidatePath("/alerts");
}

export async function deleteAlertRule(id: string): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") throw new Error("Access denied.");
  const s = await createServiceClient();
  const { error } = await s.from("change_alert_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}

export async function savePasteurizationSchedule(_previous: AlertRuleResult | null, formData: FormData): Promise<AlertRuleResult> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, error: "Access denied." };
  const machineId = String(formData.get("machine_id") ?? "");
  const seriesName = String(formData.get("series_name") ?? "").trim() || null;
  const anchorDate = String(formData.get("anchor_date") ?? "");
  const intervalDays = Number(formData.get("interval_days"));
  const startLocal = String(formData.get("start_local") ?? "");
  const durationMinutes = Number(formData.get("duration_minutes"));
  const timeZone = String(formData.get("time_zone") ?? "Europe/Madrid");
  if (!UUID.test(machineId)) return { ok: false, error: "Select a machine." };
  if (!DATE.test(anchorDate) || Number.isNaN(Date.parse(`${anchorDate}T00:00:00Z`))) return { ok: false, error: "Select a valid anchor date." };
  if (!TIME.test(startLocal)) return { ok: false, error: "Select a valid local start time." };
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3) return { ok: false, error: "Recurrence must be every one, two, or three days." };
  if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720) return { ok: false, error: "Window duration must be between 30 minutes and 12 hours." };
  if (!validTimeZone(timeZone)) return { ok: false, error: "Enter a valid IANA timezone." };
  const s = await createServiceClient();
  const { data: machine, error: machineError } = await s.from("machines").select("id").eq("id", machineId).maybeSingle();
  if (machineError || !machine) return { ok: false, error: "Machine not found." };
  const { error } = await s.from("machine_pasteurization_schedules").insert({
    machine_id: machineId, series_name: seriesName, anchor_date: anchorDate, interval_days: intervalDays,
    start_local: startLocal, duration_minutes: durationMinutes, time_zone: timeZone, created_by: session.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/alerts");
  return { ok: true };
}

export async function acceptPasteurizationSuggestion(formData: FormData): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") throw new Error("Access denied.");
  const suggestionId = String(formData.get("suggestion_id") ?? "");
  const anchorDate = String(formData.get("anchor_date") ?? "");
  const intervalDays = Number(formData.get("interval_days"));
  const startLocal = String(formData.get("start_local") ?? "");
  const durationMinutes = Number(formData.get("duration_minutes"));
  if (!UUID.test(suggestionId) || !DATE.test(anchorDate) || !TIME.test(startLocal)
    || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3
    || !Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720) throw new Error("Invalid pasteurization schedule.");
  const { error } = await (await createServiceClient()).rpc("accept_pasteurization_window_suggestion", {
    p_suggestion_id: suggestionId, p_actor_id: session.id, p_anchor_date: anchorDate,
    p_interval_days: intervalDays, p_start_local: startLocal, p_duration_minutes: durationMinutes,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}

export async function rejectPasteurizationSuggestion(id: string): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin" || !UUID.test(id)) throw new Error("Access denied.");
  const { error } = await (await createServiceClient()).from("pasteurization_window_suggestions")
    .update({ status: "rejected", reviewed_by: session.id, reviewed_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}

export async function setPasteurizationScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin" || !UUID.test(id)) throw new Error("Access denied.");
  const { error } = await (await createServiceClient()).from("machine_pasteurization_schedules")
    .update({ enabled, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}

export async function deletePasteurizationSchedule(id: string): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin" || !UUID.test(id)) throw new Error("Access denied.");
  const { error } = await (await createServiceClient()).from("machine_pasteurization_schedules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}
