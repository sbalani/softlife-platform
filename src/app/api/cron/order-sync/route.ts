import { NextResponse } from "next/server";
import { DEFAULT_TZ, ymd } from "@/lib/dates";
import { ingestOrders } from "@/lib/data/order-sync";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

async function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`) return true;

  const token = request.headers.get("x-supabase-cron-token");
  if (!token || token.length < 32) return false;
  const { data, error } = await (await createServiceClient()).rpc("verify_order_sync_cron_token", { p_token: token });
  if (error) console.error("[order-sync-cron] Could not verify Supabase cron token:", error);
  return !error && data === true;
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const today = ymd(now, DEFAULT_TZ);
  const yesterday = ymd(new Date(+now - 86_400_000), DEFAULT_TZ);
  const result = await ingestOrders(yesterday, today, [], "cron");
  return NextResponse.json(result, { status: result.status === "succeeded" ? 200 : 500 });
}
