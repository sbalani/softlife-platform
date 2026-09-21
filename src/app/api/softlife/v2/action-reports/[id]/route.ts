import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { authorizedMobileActionReport } from "@/lib/data/mobile-action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { modesFromLegacyKind, parseActionReportModes } from "@/lib/action-report-modes";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const reportId = (await params).id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  const s = await createServiceClient();
  if (!await authorizedMobileActionReport(s, session, reportId)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  const { data, error } = await s.from("service_action_reports")
    .select("id,client_uuid,machine_id,occurred_at,status,revision,action_kind,action_modes,provenance_status,notes,cleaning_material_used,water_bucket_count,machines(name,display_name),service_action_refill_lines(id,line_number,quantity,inventory_quantity,unit,product_name,observed_lot_code,observed_odoo_lot_id,finished_bottle,left_unfinished_bottle,provenance_status,unresolved_reason),service_action_attachments(id,refill_line_id,kind,mime_type,size_bytes,created_at),service_action_report_incidents(incidents(id,title,status))")
    .eq("id", reportId).maybeSingle();
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  if (!data) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  const row = data as Record<string, unknown>;
  const machine = (Array.isArray(row.machines) ? row.machines[0] : row.machines) as { name: string; display_name: string | null } | null;
  const lines = ((row.service_action_refill_lines as Record<string, unknown>[]) ?? []).sort((a, b) => Number(a.line_number) - Number(b.line_number));
  const incidents = ((row.service_action_report_incidents as { incidents: { id: string; title: string; status: string } | null }[]) ?? []).flatMap((link) => link.incidents ? [link.incidents] : []);
  return Response.json({
    report_id: row.id, client_uuid: row.client_uuid, machine_id: row.machine_id,
    machine_name: machine?.display_name || machine?.name || "Unknown machine",
    occurred_at: row.occurred_at, status: row.status, revision: row.revision,
    action_kind: row.action_kind, action_modes: parseActionReportModes(row.action_modes, row.action_kind) ?? modesFromLegacyKind(row.action_kind),
    provenance_status: row.provenance_status, notes: row.notes,
    cleaning: { material_used: row.cleaning_material_used, water_buckets: row.water_bucket_count },
    refill_lines: lines.map((line) => ({
      server_line_id: line.id, quantity: line.quantity, inventory_quantity: line.inventory_quantity,
      unit: line.unit, product_name: line.product_name, lot_code: line.observed_lot_code,
      odoo_lot_id: line.observed_odoo_lot_id, finished_bottle: line.finished_bottle,
      left_unfinished_bottle: line.left_unfinished_bottle, provenance_status: line.provenance_status,
      unresolved_reason: line.unresolved_reason,
    })),
    attachments: row.service_action_attachments ?? [], incidents,
    incident_ids: incidents.map((incident) => incident.id).sort(),
  }, { headers: { "cache-control": "no-store" } });
}
