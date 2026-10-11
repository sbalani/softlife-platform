"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type DefrostActionResult = { ok: boolean; error?: string };

export async function runDefrostNow(machineId: string, imei: string, requestId: string, overrideReason?: string): Promise<DefrostActionResult> {
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") return { ok: false, error: "Admin access required." };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(machineId) || !uuid.test(requestId)) return { ok: false, error: "Invalid defrost request." };
  const s = await createServiceClient();
  const reason = overrideReason?.trim() ?? "";
  const { error } = await s.rpc("request_manual_defrost", { p_machine_id: machineId, p_admin_id: actor.id, p_request_id: requestId, p_allow_warnings: reason.length >= 5, p_override_reason: reason });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/machines/${imei}`);
  return { ok: true };
}
