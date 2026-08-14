"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type AlertRuleResult = { ok: boolean; error?: string };

const NUMERIC_FIELDS = new Set(["price", "marketPrice", "stock", "temperature"]);
const STATUS_FIELDS = new Set(["cup_empty", "material_empty", "device_online", "cup_foreign_object", "ordering_system_fault", "cup_blocked", "cup_take_fault", "mixture_ratio_fault"]);
const PRODUCT_FIELDS = new Set(["price", "marketPrice", "stock"]);

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
