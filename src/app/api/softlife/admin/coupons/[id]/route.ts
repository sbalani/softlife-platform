import { getApiSession } from "@/lib/auth/api-session";
import { deleteAdminCoupon, generateAdminCouponCodes, getAdminCouponCodes } from "@/lib/data/coupon-admin";

export const runtime = "nodejs";

async function admin(req: Request) {
  const session = await getApiSession(req);
  if (!session) return { response: Response.json({ error: { message: "Unauthorized" } }, { status: 401 }) };
  if (session.role !== "admin") return { response: Response.json({ error: { message: "Forbidden" } }, { status: 403 }) };
  return { session };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await admin(req);
  if ("response" in auth) return auth.response;
  try {
    return Response.json({ records: await getAdminCouponCodes((await params).id) });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 400 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await admin(req);
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null) as { num?: unknown } | null;
  const result = await generateAdminCouponCodes((await params).id, Number(body?.num), auth.session);
  return result.ok ? Response.json(result) : Response.json({ error: { message: result.error } }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await admin(req);
  if ("response" in auth) return auth.response;
  const result = await deleteAdminCoupon((await params).id, auth.session);
  return result.ok ? Response.json(result) : Response.json({ error: { message: result.error } }, { status: 400 });
}
