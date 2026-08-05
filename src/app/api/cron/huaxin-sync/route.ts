import { NextResponse } from "next/server";
import { runHuaxinFleetSync } from "@/lib/data/huaxin-fleet-sync";

export const runtime = "nodejs";

/** Invoked by Vercel Cron (hourly/daily). Pulls the Huaxin device list and
 *  upserts machines (matched by device_imei). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runHuaxinFleetSync("cron"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Huaxin not configured" ? 400 : 500 });
  }
}
