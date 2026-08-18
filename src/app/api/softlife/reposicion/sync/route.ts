import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { persistMobileActionReport, preserveLegacyBatchPhotos } from "@/lib/mobile-action-reports";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ accepted: [], rejected: [] });
  }
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "service.refill")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const body = await req.json();
  const records = body.records;
  if (!Array.isArray(records) || records.length > 50) return Response.json({ error: { message: "Invalid refill batch" } }, { status: 400 });

  try {
    const s = await createServiceClient();
    const accepted: string[] = [];
    const rejected: { client_uuid: string; reason: string }[] = [];

    for (const r of records) {
      if (!r || typeof r !== "object") { rejected.push({ client_uuid: "", reason: "Invalid refill record" }); continue; }
      const clientUuid = String(r.client_uuid ?? "");
      const submittedMachineId = String(r.machine_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(clientUuid) || !/^[0-9a-f-]{36}$/i.test(submittedMachineId)) {
        rejected.push({ client_uuid: clientUuid, reason: "Invalid refill identifiers" });
        continue;
      }

      const { data: machine } = await s
        .from("machines")
        .select("id")
        .eq("id", submittedMachineId)
        .maybeSingle();
      if (!machine) {
        rejected.push({ client_uuid: clientUuid, reason: "Machine not found" });
        continue;
      }
      const eventTime = String(r.device_event_time ?? new Date().toISOString());
      if (!Number.isFinite(Date.parse(eventTime)) || Date.parse(eventTime) > Date.now() + 5 * 60_000) {
        rejected.push({ client_uuid: clientUuid, reason: "Invalid event time" });
        continue;
      }
      if (!await canAccessMobileMachine(s, session, submittedMachineId, eventTime)) {
        rejected.push({ client_uuid: clientUuid, reason: "Machine access denied" });
        continue;
      }
      if (!await canAccessMobileMachine(s, session, submittedMachineId, new Date().toISOString())) {
        rejected.push({ client_uuid: clientUuid, reason: "Current machine access denied" }); continue;
      }
      const rawLines = Array.isArray(r.lines) ? r.lines as Record<string, unknown>[] : [];
      if (rawLines.length > 20 || rawLines.some((line) => !line || typeof line !== "object")) {
        rejected.push({ client_uuid: clientUuid, reason: "Invalid refill lines" }); continue;
      }
      const lines = rawLines.map((line) => ({
        odoo_lot_id: Number(line.lot_id),
        quantity_used: Number(line.quantity_used),
        batch_photo: line.batch_photo ?? null,
      }));
      const legacyLines = rawLines;
      const legacyLotIds = legacyLines.map((line) => String(line.lot_id ?? ""));
      if (legacyLotIds.length && legacyLotIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))) {
        const { error } = await s.rpc("record_refill", {
          p_client_uuid: clientUuid, p_machine_id: submittedMachineId, p_operator_id: session.id,
          p_device_event_time: eventTime, p_payload: { ...r, operator_id: session.id },
        });
        if (error) rejected.push({ client_uuid: clientUuid, reason: error.message }); else accepted.push(clientUuid);
        continue;
      }
      if (!lines.length || lines.length > 20 || lines.some((line) => !Number.isInteger(line.odoo_lot_id) || line.odoo_lot_id < 1 || !Number.isFinite(line.quantity_used) || line.quantity_used <= 0)) {
        rejected.push({ client_uuid: clientUuid, reason: "Invalid refill lines" });
        continue;
      }
      const { data: existingLegacy } = await s.from("reposiciones").select("id,service_action_report_id").eq("client_uuid", clientUuid).maybeSingle();
      if (existingLegacy && !existingLegacy.service_action_report_id) {
        const { error } = await s.rpc("record_machine_service", { p_visit_uuid: clientUuid, p_machine_id: submittedMachineId, p_operator_id: session.id, p_device_event_time: eventTime, p_cleaning_material_used: null, p_water_bucket_count: null, p_refill_lines: lines });
        if (error) rejected.push({ client_uuid: clientUuid, reason: error.message }); else accepted.push(clientUuid);
        continue;
      }
      try {
        const result = await persistMobileActionReport(s, session, { client_uuid: clientUuid, machine_id: submittedMachineId, occurred_at: eventTime, status: "confirmed", revision: 0, action_kind: "refill", refill_lines: lines.map((line) => ({ odoo_lot_id: line.odoo_lot_id, quantity: line.quantity_used, unit: "unit" })) });
        await preserveLegacyBatchPhotos(s, result.id, rawLines);
        accepted.push(clientUuid);
      } catch (error) { rejected.push({ client_uuid: clientUuid, reason: error instanceof Error ? error.message : String(error) }); }
    }

    return Response.json({ accepted, rejected });
  } catch (e) {
    return Response.json(
      { accepted: [], rejected: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
