import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, canDismissMobileAlert } from "@/lib/auth/mobile-authorization";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!canDismissMobileAlert(session)) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });

  const alertId = (await params).id;
  if (!UUID.test(alertId)) return Response.json({ error: { message: "Invalid alert ID" } }, { status: 400 });

  try {
    const s = await createServiceClient();
    const { data: alert, error: alertError } = await s.from("alerts").select("id,machine_id,resolved_at").eq("id", alertId).maybeSingle();
    if (alertError) throw alertError;
    if (!alert) return Response.json({ error: { message: "Alert not found or not accessible" } }, { status: 404 });

    const now = new Date().toISOString();
    const accessible = alert.machine_id
      ? await canAccessMobileMachine(s, session, alert.machine_id, now)
      : session.role === "admin";
    if (!accessible) return Response.json({ error: { message: "Alert not found or not accessible" } }, { status: 404 });
    if (alert.resolved_at) return Response.json({ ok: true });

    const { error } = await s.from("alerts").update({ resolved_at: now, resolved_by: session.id })
      .eq("id", alertId).is("resolved_at", null);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[mobile-alert-dismiss]", error);
    return Response.json({ error: { message: "Could not dismiss alert" } }, { status: 500 });
  }
}
