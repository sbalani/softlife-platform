import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { getIncidents } from "@/lib/data/incidents";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const incidentId = (await params).id;
  if (!UUID.test(incidentId)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  const body = await request.json().catch(() => null) as { resolution_summary?: unknown } | null;
  const summary = typeof body?.resolution_summary === "string" ? body.resolution_summary.trim().slice(0, 2000) : "";
  if (!summary) return Response.json({ error: { message: "Describe how the incident was resolved." } }, { status: 400 });
  const service = await createServiceClient();
  const machineIds = await mobileMachineIds(service, session);
  const profile = { id: session.id, email: session.email, role: session.role, tenant_id: session.tenantId, full_name: null };
  const accessible = await getIncidents(profile, { machineIds: machineIds ?? undefined });
  if (!accessible.some((incident) => incident.id === incidentId)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  const { error } = await service.rpc("resolve_incident", {
    p_incident_id: incidentId,
    p_actor_id: session.id,
    p_resolution_summary: summary,
  });
  if (error) {
    const denied = /access denied|not found/i.test(error.message);
    const conflict = /active|status|resolved|transition|telemetry/i.test(error.message);
    return Response.json({ error: { message: error.message } }, { status: denied ? 404 : conflict ? 409 : 500 });
  }
  return Response.json({ ok: true });
}
