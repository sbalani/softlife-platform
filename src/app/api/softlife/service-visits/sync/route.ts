import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { persistMobileActionReport, preserveLegacyBatchPhotos } from "@/lib/mobile-action-reports";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "service.refill") || !hasMobileCapability(session, "service.clean")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const records = (await req.json()).records;
  if (!Array.isArray(records) || records.length > 50) return Response.json({ error: { message: "Invalid service visits" } }, { status: 400 });
  const accepted: string[] = [];
  const rejected: { client_uuid: string; reason: string }[] = [];
  const s = await createServiceClient();
  for (const record of records) {
    if (!record || typeof record !== "object") { rejected.push({ client_uuid: "", reason: "Invalid service visit" }); continue; }
    const clientUuid = String(record.client_uuid ?? "");
    const machineId = String(record.machine_id ?? "");
    const eventTime = String(record.device_event_time ?? "");
    const materialUsed = typeof record.cleaning_material_used === "boolean" ? record.cleaning_material_used : null;
    const waterBuckets = Number(record.water_bucket_count);
    const rawLines = Array.isArray(record.lines) ? record.lines as Record<string, unknown>[] : [];
    if (rawLines.length > 20 || rawLines.some((line) => !line || typeof line !== "object")) {
      rejected.push({ client_uuid: clientUuid, reason: "Invalid combined service lines" }); continue;
    }
    const lines = rawLines.map((line) => ({
      odoo_lot_id: Number(line.lot_id), quantity_used: Number(line.quantity_used), batch_photo: line.batch_photo ?? null,
    }));
    if (!/^[0-9a-f-]{36}$/i.test(clientUuid) || !/^[0-9a-f-]{36}$/i.test(machineId) || !Number.isFinite(Date.parse(eventTime)) || Date.parse(eventTime) > Date.now() + 5 * 60_000 || materialUsed === null || !Number.isInteger(waterBuckets) || waterBuckets < 0 || waterBuckets > 20 || !lines.length || lines.length > 20 || lines.some((line) => !Number.isInteger(line.odoo_lot_id) || line.odoo_lot_id < 1 || !Number.isFinite(line.quantity_used) || line.quantity_used <= 0)) {
      rejected.push({ client_uuid: clientUuid, reason: "Invalid combined service visit" }); continue;
    }
    if (!await canAccessMobileMachine(s, session, machineId, eventTime)) {
      rejected.push({ client_uuid: clientUuid, reason: "Machine access denied" }); continue;
    }
    if (!await canAccessMobileMachine(s, session, machineId, new Date().toISOString())) {
      rejected.push({ client_uuid: clientUuid, reason: "Current machine access denied" }); continue;
    }
    const [{ data: existingClean }, { data: existingRefill }] = await Promise.all([
      s.from("clean_logs").select("id,service_action_report_id").eq("client_uuid", clientUuid).maybeSingle(),
      s.from("reposiciones").select("id,service_action_report_id").eq("client_uuid", clientUuid).maybeSingle(),
    ]);
    if ((existingClean && !existingClean.service_action_report_id) || (existingRefill && !existingRefill.service_action_report_id)) {
      const { error } = await s.rpc("record_machine_service", { p_visit_uuid: clientUuid, p_machine_id: machineId, p_operator_id: session.id, p_device_event_time: eventTime, p_cleaning_material_used: materialUsed, p_water_bucket_count: waterBuckets, p_refill_lines: lines });
      if (error) rejected.push({ client_uuid: clientUuid, reason: error.message }); else accepted.push(clientUuid);
      continue;
    }
    try {
      const result = await persistMobileActionReport(s, session, { client_uuid: clientUuid, machine_id: machineId, occurred_at: eventTime, status: "confirmed", revision: 0, action_kind: "both", cleaning: { cleaning_material_used: materialUsed, water_bucket_count: waterBuckets }, refill_lines: lines.map((line) => ({ odoo_lot_id: line.odoo_lot_id, quantity: line.quantity_used, unit: "unit" })) });
      await preserveLegacyBatchPhotos(s, result.id, rawLines);
      accepted.push(clientUuid);
    } catch (error) { rejected.push({ client_uuid: clientUuid, reason: error instanceof Error ? error.message : String(error) }); }
  }
  return Response.json({ accepted, rejected });
}
