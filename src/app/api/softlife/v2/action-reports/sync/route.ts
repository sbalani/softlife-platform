import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { persistMobileActionReport } from "@/lib/mobile-action-reports";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  let body: { records?: unknown };
  try { body = await request.json() as { records?: unknown }; }
  catch { return Response.json({ error: { message: "Invalid JSON" } }, { status: 400 }); }
  if (!Array.isArray(body.records) || body.records.length > 50) return Response.json({ error: { message: "Invalid Action Report batch" } }, { status: 400 });
  const accepted: { client_uuid: string; report_id: string; status: string; revision: number; provenance_status: string; warning?: string }[] = [];
  const rejected: { client_uuid: string; reason: string }[] = [];
  const s = await createServiceClient();
  for (const value of body.records) {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const clientUuid = String(record.client_uuid ?? "");
    try {
      const result = await persistMobileActionReport(s, session, record);
      accepted.push({ client_uuid: clientUuid, report_id: result.id, status: result.status, revision: result.revision, provenance_status: result.provenance_status, warning: result.projection_error ? "Legacy projection needs review" : undefined });
    } catch (error) { rejected.push({ client_uuid: clientUuid, reason: error instanceof Error ? error.message : String(error) }); }
  }
  return Response.json({ accepted, rejected });
}

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const s = await createServiceClient();
  const allowedIds = await mobileMachineIds(s, session);
  if (allowedIds?.length === 0) return Response.json({ records: [], scope_version: session.scopeVersion });
  let query = s.from("service_action_reports")
    .select("id,client_uuid,machine_id,occurred_at,action_kind,action_modes,status,notes,cleaning_material_used,water_bucket_count,provenance_status,revision,mobile_draft_payload,updated_at,service_action_refill_lines(id,line_number,quantity,unit,product_name,observed_lot_code,observed_odoo_lot_id,provenance_status,unresolved_reason),service_action_attachments(id,refill_line_id,kind,mime_type,size_bytes,created_at)")
    .eq("operator_id", session.id).eq("status", "draft").order("updated_at", { ascending: false }).limit(100);
  if (allowedIds) query = query.in("machine_id", allowedIds);
  const { data, error } = await query;
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  const records = ((data as Record<string, unknown>[]) ?? []).map((row) => {
    const serverLines = ((row.service_action_refill_lines as Record<string, unknown>[]) ?? []).sort((a, b) => Number(a.line_number) - Number(b.line_number));
    const payload = row.mobile_draft_payload && typeof row.mobile_draft_payload === "object" ? row.mobile_draft_payload as Record<string, unknown> : {
      client_uuid: row.client_uuid, machine_id: row.machine_id, occurred_at: row.occurred_at,
      status: row.status, action_kind: row.action_kind, action_modes: row.action_modes, notes: row.notes,
      cleaning: { material_used: row.cleaning_material_used, water_buckets: row.water_bucket_count },
      refill_lines: serverLines.map((line) => ({ server_line_id: line.id, quantity: line.quantity, unit: line.unit, product_name: line.product_name, lot_code: line.observed_lot_code, odoo_lot_id: line.observed_odoo_lot_id, provenance_status: line.provenance_status, unresolved_reason: line.unresolved_reason })),
    };
    let serverLineIndex = 0;
    const refillLines = (Array.isArray(payload.refill_lines) ? payload.refill_lines as Record<string, unknown>[] : []).map((line) => {
      const hasCanonicalLine = Number(line.quantity) > 0;
      const serverLine = hasCanonicalLine ? serverLines[serverLineIndex++] : null;
      return { ...line, server_line_id: serverLine?.id ?? null, provenance_status: serverLine?.provenance_status ?? null, unresolved_reason: serverLine?.unresolved_reason ?? null };
    });
    return { ...payload, action_kind: row.action_kind, action_modes: row.action_modes, refill_lines: refillLines, report_id: row.id, revision: row.revision, updated_at: row.updated_at, provenance_status: row.provenance_status, attachments: row.service_action_attachments };
  });
  return Response.json({ records, scope_version: session.scopeVersion });
}
