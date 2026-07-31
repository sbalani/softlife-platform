import type { SupabaseClient } from "@supabase/supabase-js";
import { listDeviceMedia, type HuaxinConfig } from "@/lib/huaxin/client";

export type DetailMedia = { code?: string; imagePath?: string; duration?: number; intro?: string };

export async function syncMachineMedia(s: SupabaseClient, cfg: HuaxinConfig, imei: string) {
  const [{ data: machine, error: machineError }, media] = await Promise.all([
    s.from("machines").select("id").eq("device_imei", imei).maybeSingle(),
    listDeviceMedia(cfg, imei),
  ]);
  if (machineError) throw machineError;
  if (!machine) throw new Error(`Machine ${imei} is not stored in Supabase`);
  const { error } = await s.from("machine_media_snapshots").upsert({
    machine_id: machine.id,
    device_imei: imei,
    media,
    synced_at: new Date().toISOString(),
  });
  if (error) throw error;
  return media;
}
