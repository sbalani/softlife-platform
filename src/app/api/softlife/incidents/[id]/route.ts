import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { getIncidents } from "@/lib/data/incidents";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  const machineIds = await mobileMachineIds(await createServiceClient(), session);
  const profile = { id: session.id, email: session.email, role: session.role, tenant_id: session.tenantId, full_name: null };
  const records = await getIncidents(profile, { machineIds: machineIds ?? undefined });
  const incident = records.find((record) => record.id === id);
  if (!incident) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  return Response.json(incident, { headers: { "cache-control": "no-store" } });
}
