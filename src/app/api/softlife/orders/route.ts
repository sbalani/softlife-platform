import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { mobileAnalyticsRange, mobileOrders } from "@/lib/data/mobile-analytics";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "analytics.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const { dateFrom, dateTo, valid } = mobileAnalyticsRange(req);
  if (!valid) return Response.json({ error: { message: "Use a valid date range of up to 90 days." } }, { status: 400 });
  try {
    const service = await createServiceClient();
    return Response.json(await mobileOrders(await mobileMachineIds(service, session), dateFrom, dateTo, service));
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
