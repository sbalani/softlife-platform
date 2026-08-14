import { getApiSession } from "@/lib/auth/api-session";
import { createAdminCoupon, type CreateCouponInput } from "@/lib/data/coupon-admin";
import { getCoupons } from "@/lib/data/coupons";
import { getMachines } from "@/lib/data/machines";

export const runtime = "nodejs";

async function admin(req: Request) {
  const session = await getApiSession(req);
  if (!session) return { response: Response.json({ error: { message: "Unauthorized" } }, { status: 401 }) };
  if (session.role !== "admin") return { response: Response.json({ error: { message: "Forbidden" } }, { status: 403 }) };
  return { session };
}

export async function GET(req: Request) {
  const auth = await admin(req);
  if ("response" in auth) return auth.response;
  const [{ coupons, latestSyncedAt, staleMachines, readError }, { machines, readError: machineError }] = await Promise.all([getCoupons(), getMachines()]);
  if (readError || machineError) return Response.json({ error: { message: readError ?? machineError } }, { status: 500 });
  return Response.json({
    coupons,
    latest_synced_at: latestSyncedAt,
    stale_machines: staleMachines,
    machines: machines.filter((machine) => machine.device_imei).map((machine) => ({ id: machine.id, name: machine.display_name || machine.name, imei: machine.device_imei! })),
  });
}

export async function POST(req: Request) {
  const auth = await admin(req);
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null) as CreateCouponInput | null;
  if (!body) return Response.json({ error: { message: "Invalid request body" } }, { status: 400 });
  const result = await createAdminCoupon(body, auth.session);
  return result.ok ? Response.json(result) : Response.json({ error: { message: result.error } }, { status: 400 });
}
