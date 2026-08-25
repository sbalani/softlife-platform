"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type IncidentActionResult = { ok: boolean; error?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const machineId = String(formData.get("machine_id") ?? "");
  if (!UUID.test(machineId)) return;
  await adminRpc("create_refill_incident", { p_machine_id: machineId });
}

export async function assignIncident(_previous: IncidentActionResult | null, formData: FormData): Promise<IncidentActionResult> {
  const incidentId = String(formData.get("incident_id") ?? "");
  const tenantId = String(formData.get("tenant_id") ?? "");
  if (!UUID.test(incidentId) || (tenantId && !UUID.test(tenantId))) return { ok: false, error: "Invalid assignment." };
  return adminRpc("assign_incident", { p_incident_id: incidentId, p_tenant_id: tenantId || null });
}

export async function setIncidentTypeAutoAssignment(formData: FormData) {
  const incidentType = String(formData.get("incident_type") ?? "").slice(0, 100);
  if (!incidentType) return;
  await adminRpc("set_incident_type_auto_assignment", { p_incident_type: incidentType, p_enabled: formData.get("enabled") === "true" });
}

export async function closeIncidentWithoutReport(_previous: IncidentActionResult | null, formData: FormData): Promise<IncidentActionResult> {
  const incidentId = String(formData.get("incident_id") ?? "");
  if (!UUID.test(incidentId)) return { ok: false, error: "Invalid incident." };
  const actor = await getSessionProfile();
  if (!actor || actor.role === "operator") return { ok: false, error: "Incident access denied." };
  const { error } = await (await createServiceClient()).rpc("close_incident_without_report", { p_incident_id: incidentId, p_actor_id: actor.id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/incidents");
  revalidatePath("/alerts");
  revalidatePath("/machines");
  return { ok: true };
}
