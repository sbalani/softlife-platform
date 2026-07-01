import { NextResponse } from "next/server";
import { getConfigFromEnv, listDevices } from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

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
  for (const d of devices) {
    if (!d.deviceImei) continue;
    const { error } = await supabase.from("machines").upsert(
      {
        device_imei: d.deviceImei,
        device_id_huaxin: d.deviceId ?? null,
        name: d.deviceName ?? d.deviceImei,
        huaxin_last_sync: new Date().toISOString(),
      },
      { onConflict: "device_imei" },
    );
    if (!error) synced++;
  }

  return NextResponse.json({ synced, devicesSeen: devices.length, stored: true });
}
