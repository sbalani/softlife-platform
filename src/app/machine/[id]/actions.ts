"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { canAccessMachine } from "@/lib/data/service-access";
import { recordMachineService } from "@/lib/data/machine-service";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ServiceResult = { ok: boolean; error?: string };

export async function submitMachineService(_previous: ServiceResult | null, formData: FormData): Promise<ServiceResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Service is not configured." };
  const actor = await getSessionProfile();
  if (!actor) return { ok: false, error: "Sign in again before recording this visit." };
  const machineId = String(formData.get("machine_id") ?? "");
  const visitUuid = String(formData.get("visit_uuid") ?? "");
  const eventTime = String(formData.get("event_time") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(machineId) || !/^[0-9a-f-]{36}$/i.test(visitUuid) || !Number.isFinite(Date.parse(eventTime)) || Date.parse(eventTime) > Date.now() + 5 * 60_000 || !["refill", "cleaning", "both"].includes(mode)) return { ok: false, error: "Invalid service visit." };

  const hasCleaning = mode === "cleaning" || mode === "both";
  const hasRefill = mode === "refill" || mode === "both";
  const materialValue = String(formData.get("cleaning_material_used") ?? "");
  const bucketValue = String(formData.get("water_bucket_count") ?? "");
  const bucketCount = bucketValue === "" ? null : Number(bucketValue);
  if (hasCleaning && !["yes", "no"].includes(materialValue)) return { ok: false, error: "Confirm whether cleaning material was used." };
  if (hasCleaning && (!Number.isInteger(bucketCount) || bucketCount === null || bucketCount < 0 || bucketCount > 20)) return { ok: false, error: "Water buckets must be a whole number from 0 to 20." };

  const lotIds = formData.getAll("odoo_lot_id").map(Number);
  const quantities = formData.getAll("quantity_used").map(Number);
  if (hasRefill && (!lotIds.length || lotIds.length > 20 || lotIds.length !== quantities.length || lotIds.some((lotId) => !Number.isInteger(lotId) || lotId <= 0) || quantities.some((quantity) => !Number.isFinite(quantity) || quantity <= 0))) return { ok: false, error: "Select a lot and enter a positive quantity for every refill line." };

  try {
    const s = await createServiceClient();
    if (!await canAccessMachine(s, actor, machineId, eventTime)) return { ok: false, error: "You do not have access to this machine." };
    await recordMachineService(s, {
      visitUuid,
      machineId,
      operatorId: actor.id,
      eventTime,
      cleaningMaterialUsed: hasCleaning ? materialValue === "yes" : null,
      waterBucketCount: hasCleaning ? bucketCount : null,
      refillLines: hasRefill ? lotIds.map((lotId, index) => ({ odoo_lot_id: lotId, quantity_used: quantities[index] })) : [],
    });
    const { data: machine } = await s.from("machines").select("device_imei").eq("id", machineId).maybeSingle();
    revalidatePath(`/machine/${machineId}`);
    if (machine?.device_imei) revalidatePath(`/machines/${machine.device_imei}`);
    revalidatePath("/refills");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
