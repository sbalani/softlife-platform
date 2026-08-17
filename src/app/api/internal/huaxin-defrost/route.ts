import { timingSafeEqual } from "node:crypto";
import { call, getConfigFromEnv } from "@/lib/huaxin/client";

export const runtime = "nodejs";

const ALLOWED_PATHS = new Set([
  "/machine/cloud/api/device/configure/status/detail",
  "/machine/cloud/api/remote/control/data",
]);

function authorized(request: Request) {
  const expected = process.env.HUAXIN_DEFROST_BRIDGE_TOKEN;
  const supplied = request.headers.get("x-defrost-bridge-token");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { path?: unknown; extra?: unknown };
    if (typeof body.path !== "string" || !ALLOWED_PATHS.has(body.path)) {
      return Response.json({ error: "Unsupported Huaxin path" }, { status: 400 });
    }
    if (!body.extra || typeof body.extra !== "object" || Array.isArray(body.extra)) {
      return Response.json({ error: "Invalid Huaxin request" }, { status: 400 });
    }
    const config = getConfigFromEnv();
    if (!config) return Response.json({ error: "Huaxin is not configured" }, { status: 503 });
    return Response.json(await call(body.path, config, body.extra as Record<string, unknown>));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[huaxin-defrost-bridge] Request failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
