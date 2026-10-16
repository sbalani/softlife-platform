import { timingSafeEqual } from "node:crypto";
import { getConfigFromEnv, listAllOrders, listDevices } from "@/lib/huaxin/client";

export const runtime = "nodejs";
export const maxDuration = 300;

const IMEI = /^\d{8,20}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function authorized(request: Request) {
  const expected = process.env.HUAXIN_ORDER_BRIDGE_TOKEN;
  const supplied = request.headers.get("x-huaxin-order-token");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function validRange(from: string, to: string) {
  if (!DATE_TIME.test(from) || !DATE_TIME.test(to) || from > to) return false;
  const fromDay = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const toDay = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(fromDay) && Number.isFinite(toDay) && toDay - fromDay <= 92 * 86_400_000;
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const config = getConfigFromEnv();
    if (!config) return Response.json({ error: "Huaxin is not configured" }, { status: 503 });

    if (body.operation === "devices") {
      return Response.json({ devices: await listDevices(config, { force: true }) });
    }
    if (body.operation !== "orders" || typeof body.device_imei !== "string" || !IMEI.test(body.device_imei)
      || typeof body.began_time !== "string" || typeof body.end_time !== "string" || !validRange(body.began_time, body.end_time)) {
      return Response.json({ error: "Invalid order bridge request" }, { status: 400 });
    }
    const orders = await listAllOrders(config, body.device_imei, body.began_time, body.end_time, 50);
    return Response.json({ orders });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[huaxin-orders-bridge] Request failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
