import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { mobileAnalyticsRange, mobileOrders } from "@/lib/data/mobile-analytics";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "analytics.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const { dateFrom, dateTo, valid } = mobileAnalyticsRange(req);
  if (!valid) return Response.json({ error: { message: "Use a valid date range of up to 90 days." } }, { status: 400 });
  try {
    const service = await createServiceClient();
    const allowedIds = await mobileMachineIds(service, session);
    const requestedMachineId = new URL(req.url).searchParams.get("machine_id");
    if (requestedMachineId && !UUID.test(requestedMachineId)) return Response.json({ error: { message: "Invalid machine" } }, { status: 400 });
    if (requestedMachineId && allowedIds && !allowedIds.includes(requestedMachineId)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
    return Response.json(await mobileOrders(requestedMachineId ? [requestedMachineId] : allowedIds, dateFrom, dateTo, service));
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
