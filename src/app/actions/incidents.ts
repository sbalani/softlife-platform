"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type IncidentActionResult = { ok: boolean; error?: string; message?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string, max: number) {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function optionalUuid(formData: FormData, key: string) {
  const value = text(formData, key, 36);
  return value && UUID.test(value) ? value : null;
}

function optionalDate(formData: FormData, key: string) {
  const value = text(formData, key, 40);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

async function incidentRpc(name: string, args: Record<string, unknown>, success?: string): Promise<IncidentActionResult> {
  const actor = await getSessionProfile();
  if (!actor) return { ok: false, error: "Incident access denied." };
  const { error } = await (await createServiceClient()).rpc(name, { ...args, p_actor_id: actor.id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/incidents");
  revalidatePath("/alerts");
  revalidatePath("/machines");
  revalidatePath("/refills");
  return { ok: true, message: success };
}

async function adminRpc(name: string, args: Record<string, unknown>): Promise<IncidentActionResult> {
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") return { ok: false, error: "Admin access required." };
  const { error } = await (await createServiceClient()).rpc(name, { ...args, p_actor_id: actor.id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/incidents");
  revalidatePath("/machines");
  return { ok: true };
}

export async function createRefillIncident(formData: FormData) {
  const machineId = text(formData, "machine_id", 36);
  if (!UUID.test(machineId)) return;
  await adminRpc("create_refill_incident", { p_machine_id: machineId });
}

export async function createIncident(_previous: IncidentActionResult | null, formData: FormData): Promise<IncidentActionResult> {
  const scope = text(formData, "scope_kind", 20);
  const title = text(formData, "title", 200);
  const incidentType = text(formData, "incident_type", 100);
  const severity = text(formData, "severity", 20);
  const machineId = optionalUuid(formData, "machine_id");
  const warehouseRaw = text(formData, "odoo_warehouse_id", 20);
  const warehouseId = warehouseRaw ? Number(warehouseRaw) : null;
  const dueAt = optionalDate(formData, "due_at");
  if (!["machine", "warehouse", "location"].includes(scope) || !title || !incidentType || !["info", "warning", "critical"].includes(severity)) return { ok: false, error: "Complete the required incident details." };
  if (scope === "machine" && !machineId) return { ok: false, error: "Select a machine." };
  if (scope === "warehouse" && (!Number.isInteger(warehouseId) || Number(warehouseId) <= 0)) return { ok: false, error: "Select a warehouse." };
  if (scope === "location" && !text(formData, "location_text", 300)) return { ok: false, error: "Enter where the incident occurred." };
  if (dueAt === undefined) return { ok: false, error: "Enter a valid due date." };
  return incidentRpc("create_incident", {
    p_scope_kind: scope,
    p_machine_id: scope === "machine" ? machineId : null,
    p_odoo_warehouse_id: scope === "warehouse" ? warehouseId : null,
    p_location_text: scope === "location" ? text(formData, "location_text", 300) : null,
    p_incident_type: incidentType,
    p_title: title,
    p_description: text(formData, "description", 2000) || null,
    p_severity: severity,
    p_due_at: dueAt,
    p_owning_tenant_id: optionalUuid(formData, "owning_tenant_id"),
    p_assigned_tenant_id: optionalUuid(formData, "assigned_tenant_id"),
    p_assigned_user_id: optionalUuid(formData, "assigned_user_id"),
  }, "Incident created.");
}

export async function updateIncidentAssignment(_previous: IncidentActionResult | null, formData: FormData): Promise<IncidentActionResult> {
  const incidentId = text(formData, "incident_id", 36);
  const dueAt = optionalDate(formData, "due_at");
  if (!UUID.test(incidentId) || dueAt === undefined) return { ok: false, error: "Invalid assignment." };
  return incidentRpc("update_incident_assignment", {
    p_incident_id: incidentId,
    p_assigned_tenant_id: optionalUuid(formData, "assigned_tenant_id"),
    p_assigned_user_id: optionalUuid(formData, "assigned_user_id"),
    p_due_at: dueAt,
  }, "Responsibility updated.");
}

export async function startIncident(_previous: IncidentActionResult | null, formData: FormData): Promise<IncidentActionResult> {
  const incidentId = text(formData, "incident_id", 36);
  if (!UUID.test(incidentId)) return { ok: false, error: "Invalid incident." };
  return incidentRpc("start_incident", { p_incident_id: incidentId }, "Work started.");
}

export async function resolveIncident(_previous: IncidentActionResult | null, formData: FormData): Promise<IncidentActionResult> {
  const incidentId = text(formData, "incident_id", 36);
  const summary = text(formData, "resolution_summary", 2000);
  if (!UUID.test(incidentId) || !summary) return { ok: false, error: "Describe how the incident was resolved." };
  return incidentRpc("resolve_incident", { p_incident_id: incidentId, p_resolution_summary: summary }, "Incident resolved.");
}

export async function reopenIncident(_previous: IncidentActionResult | null, formData: FormData): Promise<IncidentActionResult> {
  const incidentId = text(formData, "incident_id", 36);
  const reason = text(formData, "reason", 2000);
  if (!UUID.test(incidentId) || !reason) return { ok: false, error: "Enter a reason for reopening." };
  return incidentRpc("reopen_incident", { p_incident_id: incidentId, p_reason: reason }, "Incident reopened.");
}

export async function setIncidentTypeAutoAssignment(formData: FormData) {
  const incidentType = text(formData, "incident_type", 100);
  if (!incidentType) return;
  await adminRpc("set_incident_type_auto_assignment", { p_incident_type: incidentType, p_enabled: formData.get("enabled") === "true" });
}
