import { NextResponse } from "next/server";
import { getConfigFromEnv, getDeviceStatus, listDeviceProducts, listDevices, pullTemperatures } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { recordMachineStatuses, recordMachineSync } from "@/lib/data/change-log";
import { normalizeHuaxinTimestamp } from "@/lib/data/temperatures";
import { ingestOrders } from "@/lib/data/order-sync";
import { syncMachineMedia } from "@/lib/data/machine-media";

export const runtime = "nodejs";

/** Invoked by Vercel Cron (hourly/daily). Pulls the Huaxin device list and
 *  upserts machines (matched by device_imei). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cfg = getConfigFromEnv();
  if (!cfg) {
    return NextResponse.json({ error: "Huaxin not configured" }, { status: 400 });
  }

  const devices = await listDevices(cfg);

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ synced: 0, devicesSeen: devices.length, stored: false });
  }

  const supabase = await createServiceClient();
  let synced = 0;
  let statuses = 0;
  let menus = 0;
  let media = 0;
  let temperatures = 0;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  for (const d of devices) {
    if (!d.deviceImei) continue;
    const { data: machine, error } = await supabase.from("machines").upsert(
      {
        device_imei: d.deviceImei,
        device_id_huaxin: d.deviceId ?? null,
        name: (d.deviceLabel as string) || d.deviceName || d.deviceImei,
        location: (d.deviceLocation as string) ?? null,
        is_online: (d.onlineStatus as string) === "online",
        huaxin_last_sync: new Date().toISOString(),
      },
      { onConflict: "device_imei" },
    ).select("id,name,device_imei").single();
    if (error || !machine) continue;
    synced++;
    try {
      await recordMachineStatuses(supabase, machine, await getDeviceStatus(cfg, d.deviceImei));
      statuses++;
    } catch (statusError) {
      console.error(`[cron] Status monitoring failed for ${d.deviceImei}:`, statusError);
    }
    try {
      await recordMachineSync(supabase, machine, await listDeviceProducts(cfg, d.deviceImei), null);
      menus++;
    } catch (menuError) {
      console.error(`[cron] Menu monitoring failed for ${d.deviceImei}:`, menuError);
    }
    try {
      await syncMachineMedia(supabase, cfg, d.deviceImei);
      media++;
    } catch (mediaError) {
      console.error(`[cron] Media monitoring failed for ${d.deviceImei}:`, mediaError);
    }
    try {
      const readings = await pullTemperatures(cfg, d.deviceImei, yesterday, today);
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
        const { error: tempError } = await supabase.from("huaxin_temperatures").upsert(rows, {
          onConflict: "machine_id,reading_time,series_name",
          ignoreDuplicates: true,
        });
        if (tempError) throw tempError;
        temperatures += rows.length;
      }
    } catch (temperatureError) {
      console.error(`[cron] Temperature monitoring failed for ${d.deviceImei}:`, temperatureError);
    }
  }

  const orderSync = await ingestOrders(yesterday, today, [], "cron");

  return NextResponse.json({
    synced,
    statuses,
    menus,
    media,
    temperatures,
    orders: orderSync.orders,
    orderRunId: orderSync.runId,
    orderSyncStatus: orderSync.status,
    orderMachinesSucceeded: orderSync.succeededMachines,
    orderMachinesFailed: orderSync.failedMachines.length,
    orderSyncError: orderSync.error,
    devicesSeen: devices.length,
    stored: true,
  });
}
