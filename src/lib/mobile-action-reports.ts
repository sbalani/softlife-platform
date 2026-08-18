import type { SupabaseClient } from "@supabase/supabase-js";
import type { MobileSession } from "@/lib/auth/mobile-authorization";
import { canAccessMobileMachine } from "@/lib/auth/mobile-authorization";

const UUID = /^[0-9a-f-]{36}$/i;

export type MobileActionRecord = Record<string, unknown>;

export async function persistMobileActionReport(s: SupabaseClient, session: MobileSession, record: MobileActionRecord) {
  const clientUuid = String(record.client_uuid ?? "");
  const machineId = String(record.machine_id ?? "");
  const occurredAt = String(record.occurred_at ?? record.device_event_time ?? "");
  if (record.status !== "draft" && record.status !== "confirmed") throw new Error("Invalid Action Report status");
  const status = record.status;
  const actionKind = String(record.action_kind ?? "");
  if (!UUID.test(clientUuid) || !UUID.test(machineId) || !["cleaning", "refill", "both", "other"].includes(actionKind)
    || !Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) < Date.parse("2020-01-01") || Date.parse(occurredAt) > Date.now() + 5 * 60_000) throw new Error("Invalid Action Report");
  if (!await canAccessMobileMachine(s, session, machineId, occurredAt)) throw new Error("Machine access denied");
  if (!await canAccessMobileMachine(s, session, machineId, new Date().toISOString())) throw new Error("Current machine access denied");
  const hasCleaning = actionKind === "cleaning" || actionKind === "both";
  const hasRefill = actionKind === "refill" || actionKind === "both";
  const cleaning = record.cleaning && typeof record.cleaning === "object" ? record.cleaning as Record<string, unknown> : record;
  const materialUsed = typeof cleaning.cleaning_material_used === "boolean" ? cleaning.cleaning_material_used : typeof cleaning.material_used === "boolean" ? cleaning.material_used : null;
  const bucketRaw = cleaning.water_bucket_count ?? cleaning.water_buckets;
  const waterBuckets = bucketRaw === null || bucketRaw === undefined || bucketRaw === "" ? null : Number(bucketRaw);
  if (status === "confirmed" && hasCleaning && (materialUsed === null || !Number.isInteger(waterBuckets) || waterBuckets! < 0 || waterBuckets! > 20)) throw new Error("Cleaning evidence is required");
  const rawLines = Array.isArray(record.refill_lines) ? record.refill_lines as Record<string, unknown>[] : Array.isArray(record.lines) ? record.lines as Record<string, unknown>[] : [];
  if (rawLines.length > 20) throw new Error("Too many refill lines");
  const lines = hasRefill ? rawLines.map((line) => {
    const quantity = Number(line.quantity ?? line.quantity_used);
    const rawLotId = line.odoo_lot_id ?? line.lot_id;
    return { quantity, unit: String(line.unit ?? "unit").slice(0, 30), odoo_lot_id: /^\d+$/.test(String(rawLotId ?? "")) ? Number(rawLotId) : null, lot_code: String(line.lot_code ?? line.lot_name ?? "").trim().slice(0, 200) || null, product_name: String(line.product_name ?? "").trim().slice(0, 200) || null };
  }).filter((line) => status === "confirmed" || line.quantity > 0) : [];
  if (status === "confirmed" && hasRefill && (!lines.length || lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0))) throw new Error("Valid refill lines are required");
  const notes = String(record.notes ?? "").trim().slice(0, 5000) || null;
  if (status === "confirmed" && actionKind === "other" && !notes) throw new Error("Notes are required for other actions");
  const expectedRevision = Number(record.revision ?? 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid draft revision");
  const mobilePayload = {
    client_uuid: clientUuid, machine_id: machineId, occurred_at: new Date(occurredAt).toISOString(), status,
    revision: expectedRevision, action_kind: actionKind, notes,
    cleaning: { material_used: hasCleaning ? materialUsed : null, water_buckets: hasCleaning ? waterBuckets : null },
    refill_lines: hasRefill ? rawLines.map((line) => ({
      quantity: line.quantity ?? line.quantity_used ?? null,
      unit: String(line.unit ?? "unit").slice(0, 30),
      odoo_lot_id: /^\d+$/.test(String(line.odoo_lot_id ?? line.lot_id ?? "")) ? Number(line.odoo_lot_id ?? line.lot_id) : null,
      lot_code: String(line.lot_code ?? line.lot_name ?? "").trim().slice(0, 200) || null,
      product_name: String(line.product_name ?? "").trim().slice(0, 200) || null,
    })) : [],
  };
  const { data, error } = await s.rpc("record_mobile_service_action_report", {
    p_client_uuid: clientUuid, p_machine_id: machineId, p_operator_id: session.id,
    p_occurred_at: new Date(occurredAt).toISOString(), p_action_kind: actionKind, p_status: status,
    p_notes: notes, p_cleaning_material_used: hasCleaning ? materialUsed : null,
    p_water_bucket_count: hasCleaning ? waterBuckets : null, p_refill_lines: lines,
    p_expected_revision: expectedRevision, p_mobile_payload: mobilePayload,
  });
  if (error) throw error;
  return data as { id: string; status: string; provenance_status: string; revision: number; projection_error?: string | null };
}

export async function preserveLegacyBatchPhotos(s: SupabaseClient, reportId: string, rawLines: Record<string, unknown>[]) {
  if (!rawLines.some((line) => typeof line.batch_photo === "string" && line.batch_photo.length > 0)) return;
  const { data: refill, error } = await s.from("reposiciones").select("id,payload_json").eq("service_action_report_id", reportId).maybeSingle();
  if (error) throw error;
  if (!refill) return;
  const payload = (refill.payload_json as Record<string, unknown> | null) ?? {};
  const existingLines = Array.isArray(payload.lines) ? payload.lines as Record<string, unknown>[] : [];
  const lines = existingLines.map((line, index) => ({ ...line, batch_photo: rawLines[index]?.batch_photo ?? null }));
  const { error: updateError } = await s.from("reposiciones").update({ payload_json: { ...payload, lines } }).eq("id", refill.id);
  if (updateError) throw updateError;
}
