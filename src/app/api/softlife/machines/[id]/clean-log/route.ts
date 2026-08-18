import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { recordMachineClean } from "@/lib/data/clean-logs";
import { persistMobileActionReport } from "@/lib/mobile-action-reports";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Supabase not configured" } }, { status: 500 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "service.clean")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const kind = body.kind === "partial" ? "partial" : body.kind === "full" ? "full" : null;
  const eventTime = String(body.device_event_time ?? "");
  const clientUuid = String(body.client_uuid ?? "");
  const materialUsed = typeof body.cleaning_material_used === "boolean" ? body.cleaning_material_used : null;
  const waterBuckets = Number(body.water_bucket_count);
  const hasEvidenceFields = body.cleaning_material_used !== undefined || body.water_bucket_count !== undefined;
  if (!kind || !Number.isFinite(Date.parse(eventTime)) || Date.parse(eventTime) > Date.now() + 5 * 60_000 || !/^[0-9a-f-]{36}$/i.test(clientUuid)) {
    return Response.json({ error: { message: "Invalid cleaning event" } }, { status: 400 });
  }
  try {
    const s = await createServiceClient();
    if (!await canAccessMobileMachine(s, session, id, eventTime)) {
      return Response.json({ error: { message: "Machine access denied" } }, { status: 403 });
    }
    if (!await canAccessMobileMachine(s, session, id, new Date().toISOString())) return Response.json({ error: { message: "Current machine access denied" } }, { status: 403 });
    if (kind === "partial" || !hasEvidenceFields) {
      await recordMachineClean(s, { machineId: id, clientUuid, operatorId: session.id, kind, eventTime });
      return Response.json({ ok: true, server_receipt_time: new Date().toISOString() });
    }
    if (materialUsed === null || !Number.isInteger(waterBuckets) || waterBuckets < 0 || waterBuckets > 20) return Response.json({ error: { message: "Invalid cleaning evidence" } }, { status: 400 });
    const { data: existingLegacy } = await s.from("clean_logs").select("id,service_action_report_id").eq("client_uuid", clientUuid).maybeSingle();
    if (existingLegacy && !existingLegacy.service_action_report_id) {
      const { error } = await s.rpc("record_machine_service", { p_visit_uuid: clientUuid, p_machine_id: id, p_operator_id: session.id, p_device_event_time: eventTime, p_cleaning_material_used: materialUsed, p_water_bucket_count: waterBuckets, p_refill_lines: [] });
      if (error) throw error;
      return Response.json({ ok: true, server_receipt_time: new Date().toISOString() });
    }
    await persistMobileActionReport(s, session, { client_uuid: clientUuid, machine_id: id, occurred_at: eventTime, status: "confirmed", action_kind: "cleaning", cleaning: { cleaning_material_used: materialUsed, water_bucket_count: waterBuckets } });
    return Response.json({ ok: true, server_receipt_time: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: { message } }, { status: message.includes("Machine not found") ? 404 : 500 });
  }
}
