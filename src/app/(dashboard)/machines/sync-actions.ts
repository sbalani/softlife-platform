"use server";

import { revalidatePath } from "next/cache";
import { getConfigFromEnv, listDevices } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type SyncResult = { ok: boolean; synced?: number; error?: string };

/** Lightweight sync: just refresh device online statuses + names (no orders/temps). */
export async function syncMachineStatuses(): Promise<SyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const devices = await listDevices(cfg, { force: true });
    const s = await createServiceClient();
    let count = 0;
    for (const d of devices) {
      if (!d.deviceImei) continue;
      const isOnline = (d.onlineStatus as string) === "online";
      await s.from("machines").upsert({
        device_imei: d.deviceImei,
        device_id_huaxin: d.deviceId ?? null,
        name: (d.deviceLabel as string) || d.deviceName || d.deviceImei,
        location: (d.deviceLocation as string) ?? null,
        state: isOnline ? "active" : "stored",
        is_online: isOnline,
        huaxin_last_sync: new Date().toISOString(),
      }, { onConflict: "device_imei" });
      count++;
    }
    revalidatePath("/machines");
    revalidatePath("/dashboard");
    return { ok: true, synced: count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncOneMachine(imei: string): Promise<SyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const devices = await listDevices(cfg, { force: true });
    const d = devices.find((x) => x.deviceImei === imei);
    if (!d) return { ok: false, error: "Device not found in Huaxin." };
    const isOnline = (d.onlineStatus as string) === "online";
    const s = await createServiceClient();
    await s.from("machines").upsert({
      device_imei: imei,
      device_id_huaxin: d.deviceId ?? null,
      name: (d.deviceLabel as string) || d.deviceName || imei,
      location: (d.deviceLocation as string) ?? null,
      state: isOnline ? "active" : "stored",
      is_online: isOnline,
      huaxin_last_sync: new Date().toISOString(),
    }, { onConflict: "device_imei" });
    revalidatePath(`/machines/${imei}`);
    revalidatePath("/machines");
    return { ok: true, synced: 1 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
