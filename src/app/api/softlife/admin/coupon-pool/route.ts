import { getApiSession } from "@/lib/auth/api-session";
import { getAdminCouponPool } from "@/lib/data/coupon-pool";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: { message: "Forbidden" } }, { status: 403 });

  const body = await req.json().catch(() => null) as { pool_id?: unknown } | null;
  if (!body || typeof body.pool_id !== "string" || !UUID.test(body.pool_id)) {
    return Response.json({ error: { message: "Invalid coupon pool ID." } }, { status: 400 });
  }

  try {
    return Response.json(await getAdminCouponPool(body.pool_id, session.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[coupon-pool] Request failed:", message);
    return Response.json({ error: { message: "Could not refresh the coupon pool." } }, { status: 502 });
  }
}
