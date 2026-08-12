"use server";

import { revalidatePath } from "next/cache";
import { getConfigFromEnv, getDeviceStatus, listDevices, listDeviceProducts } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";
import { recordMachineStatuses, recordMachineSync } from "@/lib/data/change-log";
import { syncMachineMedia } from "@/lib/data/machine-media";
import { syncCouponSnapshots } from "@/lib/data/coupons";
import { sendPendingAlertNotifications } from "@/lib/data/alert-notifications";

export type SyncResult = { ok: boolean; synced?: number; error?: string; warning?: string };

/** Refresh fleet metadata and detailed status snapshots (no menus/orders/temps). */
export async function syncMachineStatuses(): Promise<SyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const devices = await listDevices(cfg, { force: true });
    const s = await createServiceClient();
    let count = 0;
    let failed = 0;
    for (const d of devices) {
      if (!d.deviceImei) continue;
      const { data: machine, error } = await s.from("machines").upsert({
        device_imei: d.deviceImei,
        device_id_huaxin: d.deviceId ?? null,
        name: (d.deviceLabel as string) || d.deviceName || d.deviceImei,
        location: (d.deviceLocation as string) ?? null,
        is_online: (d.onlineStatus as string) === "online",
        huaxin_last_sync: new Date().toISOString(),
      }, { onConflict: "device_imei" }).select("id,name,device_imei").single();
      if (error || !machine) throw error ?? new Error(`Could not save machine ${d.deviceImei}.`);
      try {
        await recordMachineStatuses(s, machine, await getDeviceStatus(cfg, d.deviceImei));
        count++;
      } catch (statusError) {
        failed++;
        console.error(`[machine-sync] Status monitoring failed for ${d.deviceImei}:`, statusError);
      }
    }
    revalidatePath("/machines");
    revalidatePath("/dashboard");
    try { await sendPendingAlertNotifications(s); } catch (error) { console.error("[machine-sync] Alert push failed:", error); }
    return { ok: true, synced: count, warning: failed ? `${failed} machine status sync(s) failed.` : undefined };
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
    const s = await createServiceClient();
    const actor = await getSessionProfile();
    let warning: string | undefined;
    const { error: machineError } = await s.from("machines").upsert({
      device_imei: imei,
      device_id_huaxin: d.deviceId ?? null,
      name: (d.deviceLabel as string) || d.deviceName || imei,
      location: (d.deviceLocation as string) ?? null,
      is_online: (d.onlineStatus as string) === "online",
      huaxin_last_sync: new Date().toISOString(),
    }, { onConflict: "device_imei" });
    if (machineError) throw machineError;

    const { data: machine } = await s.from("machines").select("id,name").eq("device_imei", imei).maybeSingle();
    if (machine?.id) {
      await recordMachineStatuses(s, { id: machine.id, device_imei: imei, name: machine.name as string | null }, await getDeviceStatus(cfg, imei));
      await syncProductsToIngredients(s, cfg, imei, machine.id, machine.name as string | null, actor);
      try { await syncMachineMedia(s, cfg, imei); } catch (error) { console.error(`[machine-sync] Media snapshot failed for ${imei}:`, error); }
      const couponSync = await syncCouponSnapshots(s, cfg, [imei]);
      if (couponSync.failed.length) console.error(`[machine-sync] Coupon snapshot failed for ${imei}:`, couponSync.failed[0]);
      if (couponSync.failed.length) warning = "Machine synced, but its coupon snapshot failed to refresh.";
    }

    revalidatePath(`/machines/${imei}`);
    revalidatePath("/machines");
    try { await sendPendingAlertNotifications(s); } catch (error) { console.error("[machine-sync] Alert push failed:", error); }
    return { ok: true, synced: 1, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const HUAXIN_LANE_TO_CONFIG: Record<string, { position: string; product_type: string }> = {
  "2": { position: "solid_1", product_type: "topping" },
  "3": { position: "solid_2", product_type: "topping" },
  "4": { position: "solid_3", product_type: "topping" },
  "5": { position: "liquid_1", product_type: "sauce" },
  "6": { position: "liquid_2", product_type: "sauce" },
  "7": { position: "liquid_3", product_type: "sauce" },
};

async function syncProductsToIngredients(
  s: Awaited<ReturnType<typeof createServiceClient>>,
  cfg: ReturnType<typeof getConfigFromEnv>,
  imei: string,
  machineId: string,
  machineName: string | null,
  actor: SessionProfile | null,
): Promise<void> {
  if (!cfg) return;
  const menu = await listDeviceProducts(cfg, imei);
  await recordMachineSync(s, { id: machineId, device_imei: imei, name: machineName }, menu, actor);
  const { diy } = menu;
  const { data: allProducts } = await s.from("products").select("id,name,type,image_url");
  const products = (allProducts as { id: string; name: string; type: string; image_url: string | null }[]) ?? [];
  const findMatch = (name: string) =>
    products.find((p) => p.name.toLowerCase().trim() === name.toLowerCase().trim());

  const syncImage = async (productId: string | undefined | null, huaxinImage: string | undefined) => {
    if (!productId || !huaxinImage) return;
    const p = products.find((x) => x.id === productId);
    if (!p || p.image_url === huaxinImage) return;
    await s.from("products").update({ image_url: huaxinImage }).eq("id", productId);
  };

  // Base (lane 1) → machines.base_product_id
  const baseItem = diy.find((d) => String(d.position) === "1");
  if (baseItem?.goodsName) {
    const match = findMatch(baseItem.goodsName);
    const { error } = await s.from("machines")
      .update({ base_product_id: match?.id ?? null })
      .eq("id", machineId);
    if (error) throw error;
    await syncImage(match?.id, baseItem.imagePath);
  }

  // Lanes 2-7 → machine_ingredients (preserve lot data on existing rows)
  for (const [lane, mapping] of Object.entries(HUAXIN_LANE_TO_CONFIG)) {
    const item = diy.find((d) => String(d.position) === lane);
    if (!item) continue;
    const goodsName = (item.goodsName ?? "").trim();
    const match = goodsName ? findMatch(goodsName) : null;
    await syncImage(match?.id, item.imagePath);
    const { error } = await s.from("machine_ingredients").upsert({
      machine_id: machineId,
      position: mapping.position,
      product_id: match?.id ?? null,
      product_type: mapping.product_type,
      enabled: true,
    }, { onConflict: "machine_id,position" });
    if (error) throw error;
  }
}
