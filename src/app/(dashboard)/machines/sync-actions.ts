"use server";

import { revalidatePath } from "next/cache";
import { getConfigFromEnv, getDeviceStatus, listDevices, listDeviceProducts } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";
import { recordMachineStatuses, recordMachineSync } from "@/lib/data/change-log";
import { syncMachineMedia } from "@/lib/data/machine-media";
import { syncCouponSnapshots } from "@/lib/data/coupons";
import { sendPendingAlertNotifications } from "@/lib/data/alert-notifications";
import { parseMachineRefreshClaim } from "@/lib/data/huaxin-machine-refresh";

export type SyncResult = { ok: boolean; synced?: number; error?: string; warning?: string; recoveryQueued?: boolean };

/** Refresh fleet metadata and detailed status snapshots (no menus/orders/temps). */
export async function syncMachineStatuses(): Promise<SyncResult> {
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") return { ok: false, error: "Admin access required." };
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  const s = await createServiceClient();
  const owner = crypto.randomUUID();
  try {
    const { data: claimed, error: claimError } = await s.rpc("claim_huaxin_sync_lock", { p_owner: owner });
    if (claimError) throw claimError;
    if (!claimed) return { ok: false, error: "Another Huaxin refresh is already running." };
    try {
      const devices = await listDevices(cfg, { force: true });
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
    } finally {
      const { error } = await s.rpc("release_huaxin_sync_lock", { p_owner: owner });
      if (error) console.error("[machine-sync] Could not release fleet lock:", error);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncOneMachine(imei: string): Promise<SyncResult> {
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") return { ok: false, error: "Admin access required." };
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const devices = await listDevices(cfg, { force: true });
    const d = devices.find((x) => x.deviceImei === imei);
    if (!d) return { ok: false, error: "Device not found in Huaxin." };
    const s = await createServiceClient();
    let warning: string | undefined;
    let recoveryQueued = false;
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
      const refreshOwner = crypto.randomUUID();
      const { data: claimData, error: claimError } = await s.rpc("claim_huaxin_machine_refresh", { p_machine_id: machine.id, p_owner: refreshOwner });
      if (claimError) throw claimError;
      const claim = parseMachineRefreshClaim(claimData);
      if (!claim.claimed) return { ok: false, error: `Another refresh is active. Try again in ${claim.retry_after_seconds} seconds.` };
      let refreshSucceeded = false;
      try {
        const renewLease = async () => {
          const { data, error } = await s.rpc("renew_huaxin_machine_refresh", { p_machine_id: machine.id, p_owner: refreshOwner });
          if (error) throw error;
          if (!data) throw new Error("Machine refresh lease expired.");
        };
        const statuses = await getDeviceStatus(cfg, imei);
        await renewLease();
        await recordMachineStatuses(s, { id: machine.id, device_imei: imei, name: machine.name as string | null }, statuses);
        const now = new Date().toISOString();
        const { data: wokenRuns, error: wakeError } = await s.from("machine_defrost_runs")
          .update({ next_action_at: now })
          .eq("machine_id", machine.id)
          .eq("state", "recovery")
          .or(`lease_until.is.null,lease_until.lt.${now}`)
          .select("id");
        if (wakeError) throw wakeError;
        recoveryQueued = Boolean(wokenRuns?.length);
        await syncProductsToIngredients(s, cfg, imei, machine.id, machine.name as string | null, actor, renewLease);
        refreshSucceeded = true;
        try { await syncMachineMedia(s, cfg, imei); } catch (error) { console.error(`[machine-sync] Media snapshot failed for ${imei}:`, error); }
        const couponSync = await syncCouponSnapshots(s, cfg, [imei]);
        if (couponSync.failed.length) console.error(`[machine-sync] Coupon snapshot failed for ${imei}:`, couponSync.failed[0]);
        if (couponSync.failed.length) warning = "Machine synced, but its coupon snapshot failed to refresh.";
      } finally {
        const { error } = await s.rpc("release_huaxin_machine_refresh", { p_machine_id: machine.id, p_owner: refreshOwner, p_succeeded: refreshSucceeded });
        if (error) console.error(`[machine-sync] Could not release refresh lock for ${imei}:`, error);
      }
    }

    revalidatePath(`/machines/${imei}`);
    revalidatePath("/machines");
    try { await sendPendingAlertNotifications(s); } catch (error) { console.error("[machine-sync] Alert push failed:", error); }
    return { ok: true, synced: 1, warning, recoveryQueued };
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
  beforePersist?: () => Promise<void>,
): Promise<void> {
  if (!cfg) return;
  const menu = await listDeviceProducts(cfg, imei);
  await beforePersist?.();
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
