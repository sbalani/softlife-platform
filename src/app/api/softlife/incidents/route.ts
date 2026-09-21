import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { getIncidents } from "@/lib/data/incidents";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const view = new URL(request.url).searchParams.get("status") === "resolved" ? "resolved" : "open";
  const machineIds = await mobileMachineIds(await createServiceClient(), session);
  const records = await getIncidents({ id: session.id, email: session.email, role: session.role, tenant_id: session.tenantId, full_name: null }, { machineIds: machineIds ?? undefined, status: view });
  return Response.json({ records }, { headers: { "cache-control": "no-store" } });
}
