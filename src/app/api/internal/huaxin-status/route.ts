import { timingSafeEqual } from "node:crypto";
import { call, getConfigFromEnv } from "@/lib/huaxin/client";

export const runtime = "nodejs";
const IMEI = /^\d{8,20}$/;

function authorized(request: Request) {
  const expected = process.env.HUAXIN_STATUS_BRIDGE_TOKEN;
  const supplied = request.headers.get("x-huaxin-status-token");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { device_imei?: unknown };
    if (typeof body.device_imei !== "string" || !IMEI.test(body.device_imei)) {
      return Response.json({ error: "Invalid device IMEI" }, { status: 400 });
    }
    const config = getConfigFromEnv();
    if (!config) return Response.json({ error: "Huaxin is not configured" }, { status: 503 });
    return Response.json(await call("/machine/cloud/api/device/configure/status/detail", config, { device_imei: body.device_imei }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[huaxin-status-bridge] Request failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
