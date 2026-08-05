import { getConfigFromEnv, getDeviceStatus, listDeviceProducts, listDevices, pullTemperatures } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { recordMachineStatuses, recordMachineSync } from "@/lib/data/change-log";
import { normalizeHuaxinTimestamp } from "@/lib/data/temperatures";
import { ingestOrders, type OrderSyncTrigger } from "@/lib/data/order-sync";
import { syncMachineMedia } from "@/lib/data/machine-media";
import { syncCouponSnapshots } from "@/lib/data/coupons";
import { sendPendingAlertNotifications } from "@/lib/data/alert-notifications";
import { DEFAULT_TZ, ymd } from "@/lib/dates";

export async function runHuaxinFleetSync(trigger: OrderSyncTrigger = "cron") {
  const cfg = getConfigFromEnv();
  if (!cfg) throw new Error("Huaxin not configured");
  if (!isSupabaseConfigured()) return { synced: 0, devicesSeen: 0, stored: false };
  const supabase = await createServiceClient();
  const owner = crypto.randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_huaxin_sync_lock", { p_owner: owner });
  if (claimError) throw claimError;
  if (!claimed) throw new Error("A full fleet sync is already running.");
  try {
    const devices = await listDevices(cfg, { force: true });
    return await executeFleetSync(supabase, cfg, devices, trigger);
  } finally {
    const { error } = await supabase.rpc("release_huaxin_sync_lock", { p_owner: owner });
    if (error) console.error("[fleet-sync] Could not release sync lock:", error);
  }
}

async function executeFleetSync(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  cfg: NonNullable<ReturnType<typeof getConfigFromEnv>>,
  devices: Awaited<ReturnType<typeof listDevices>>,
  trigger: OrderSyncTrigger,
) {
  let synced = 0;
  let statuses = 0;
  let menus = 0;
  let media = 0;
  let temperatures = 0;
  const now = new Date();
  const today = ymd(now, DEFAULT_TZ);
  const yesterday = ymd(new Date(+now - 86_400_000), DEFAULT_TZ);

  for (const device of devices) {
    if (!device.deviceImei) continue;
    const { data: machine, error } = await supabase.from("machines").upsert({
      device_imei: device.deviceImei,
      device_id_huaxin: device.deviceId ?? null,
      name: (device.deviceLabel as string) || device.deviceName || device.deviceImei,
      location: (device.deviceLocation as string) ?? null,
      is_online: (device.onlineStatus as string) === "online",
      huaxin_last_sync: new Date().toISOString(),
    }, { onConflict: "device_imei" }).select("id,name,device_imei").single();
    if (error || !machine) continue;
    synced++;
    try {
      await recordMachineStatuses(supabase, machine, await getDeviceStatus(cfg, device.deviceImei));
      statuses++;
    } catch (error) { console.error(`[fleet-sync] Status failed for ${device.deviceImei}:`, error); }
    try {
      await recordMachineSync(supabase, machine, await listDeviceProducts(cfg, device.deviceImei), null);
      menus++;
    } catch (error) { console.error(`[fleet-sync] Menu failed for ${device.deviceImei}:`, error); }
    try {
      await syncMachineMedia(supabase, cfg, device.deviceImei);
      media++;
    } catch (error) { console.error(`[fleet-sync] Media failed for ${device.deviceImei}:`, error); }
    try {
      const readings = await pullTemperatures(cfg, device.deviceImei, yesterday, today);
      const rows = (readings.dataset ?? []).flatMap((series) => (series.data ?? []).flatMap((point, index) => {
        const value = Number(point.value);
        return Number.isFinite(value) ? [{
          machine_id: machine.id,
          reading_time: normalizeHuaxinTimestamp(readings.category?.[index]?.label, today),
          series_name: series.seriesname ?? "temperature",
          value,
        }] : [];
      }));
      if (rows.length) {
        const { error: temperatureError } = await supabase.from("huaxin_temperatures").upsert(rows, { onConflict: "machine_id,reading_time,series_name", ignoreDuplicates: true });
        if (temperatureError) throw temperatureError;
        temperatures += rows.length;
      }
    } catch (error) { console.error(`[fleet-sync] Temperature failed for ${device.deviceImei}:`, error); }
  }

  let couponSync = { synced: 0, failed: [] as string[] };
  try {
    couponSync = await syncCouponSnapshots(supabase, cfg, devices.flatMap((device) => device.deviceImei ? [device.deviceImei] : []));
  } catch (error) {
    couponSync.failed.push(error instanceof Error ? error.message : String(error));
    console.error("[fleet-sync] Coupons failed:", error);
  }
  const orderSync = await ingestOrders(yesterday, today, [], trigger);
  let notifications = 0;
  try { notifications = await sendPendingAlertNotifications(supabase); } catch (error) { console.error("[fleet-sync] Alert push failed:", error); }

  return {
    synced,
    statuses,
    menus,
    media,
    temperatures,
    coupons: couponSync.synced,
    couponMachinesFailed: couponSync.failed.length,
    orders: orderSync.orders,
    orderRunId: orderSync.runId,
    orderSyncStatus: orderSync.status,
    orderMachinesSucceeded: orderSync.succeededMachines,
    orderMachinesFailed: orderSync.failedMachines.length,
    orderSyncError: orderSync.error,
    notifications,
    devicesSeen: devices.length,
    stored: true,
  };
}
