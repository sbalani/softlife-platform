"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type AlertRuleResult = { ok: boolean; error?: string };

const ALLOWED_FIELDS = new Set(["price", "marketPrice", "stock"]);

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
  if (!name) return { ok: false, error: "Rule name is required." };
  if (!ALLOWED_FIELDS.has(field)) return { ok: false, error: "Unsupported field." };
  if (minValue === null && maxValue === null) return { ok: false, error: "Set a minimum, maximum, or both." };
  if ((minValue !== null && !Number.isFinite(minValue)) || (maxValue !== null && !Number.isFinite(maxValue))) return { ok: false, error: "Limits must be numbers." };
  if (minValue !== null && maxValue !== null && minValue > maxValue) return { ok: false, error: "Minimum cannot exceed maximum." };
  if (!new Set(["info", "warning", "critical"]).has(severity)) return { ok: false, error: "Invalid severity." };

  const s = await createServiceClient();
  const { error } = await s.from("change_alert_rules").insert({
    name,
    field,
    machine_id: String(formData.get("machine_id") ?? "") || null,
    min_value: minValue,
    max_value: maxValue,
    severity,
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

export async function deleteAlertRule(id: string): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") throw new Error("Access denied.");
  const s = await createServiceClient();
  const { error } = await s.from("change_alert_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}

export async function resolveAlert(id: string): Promise<void> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") throw new Error("Access denied.");
  const s = await createServiceClient();
  const { error } = await s.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: session.id }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/alerts");
}
