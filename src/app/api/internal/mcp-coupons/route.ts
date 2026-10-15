import { timingSafeEqual } from "node:crypto";
import { couponMcpRead, createCouponGroupFromMcp, distributeCouponFromMcp, mcpCreateCouponInput } from "@/lib/coupon-mcp";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(request: Request) {
  const expected = process.env.COUPON_MCP_BRIDGE_TOKEN;
  const supplied = request.headers.get("x-coupon-mcp-token");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const actorId = String(body.actor_id ?? "");
    if (!UUID.test(actorId)) return Response.json({ error: "Invalid coupon actor" }, { status: 400 });
    const { data: actor, error } = await (await createServiceClient()).from("profiles").select("id,email,role").eq("id", actorId).maybeSingle();
    if (error) throw error;
    if (!actor || actor.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    if (body.action === "list") return Response.json(await couponMcpRead());
    if (body.action === "get") return Response.json(await couponMcpRead(String(body.group ?? "")));
    if (body.action === "create") return Response.json(await createCouponGroupFromMcp(String(body.idempotency_key ?? ""), mcpCreateCouponInput(body), actor));
    if (body.action === "distribute") return Response.json(await distributeCouponFromMcp(String(body.idempotency_key ?? ""), String(body.group ?? ""), body.code == null ? null : String(body.code), String(body.note ?? ""), actor));
    return Response.json({ error: "Unknown coupon action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mcp-coupons] Request failed:", message);
    return Response.json({ error: message }, { status: 400 });
  }
}
