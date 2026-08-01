import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { recordMachineClean } from "@/lib/data/clean-logs";
import { canAccessMachine } from "@/lib/data/service-access";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Supabase not configured" } }, { status: 500 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const kind = body.kind === "partial" ? "partial" : body.kind === "full" ? "full" : null;
  const eventTime = String(body.device_event_time ?? "");
  const clientUuid = String(body.client_uuid ?? "");
  if (!kind || !Number.isFinite(Date.parse(eventTime)) || Date.parse(eventTime) > Date.now() + 5 * 60_000 || !/^[0-9a-f-]{36}$/i.test(clientUuid)) {
    return Response.json({ error: { message: "Invalid cleaning event" } }, { status: 400 });
  }
  try {
    const s = await createServiceClient();
    if (!await canAccessMachine(s, { role: session.role, tenant_id: session.tenantId }, id, eventTime)) {
      return Response.json({ error: { message: "Machine access denied" } }, { status: 403 });
    }
    await recordMachineClean(s, {
      machineId: id,
      clientUuid,
      operatorId: session.id,
      kind,
      eventTime,
    });
    return Response.json({ ok: true, server_receipt_time: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: { message } }, { status: message.includes("Machine not found") ? 404 : 500 });
  }
}
