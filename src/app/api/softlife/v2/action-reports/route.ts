import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { modesFromLegacyKind, parseActionReportModes } from "@/lib/action-report-modes";
import { actionReportCalendarState } from "@/lib/action-report-calendar";
import { DEFAULT_TZ, ymd } from "@/lib/dates";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const s = await createServiceClient();
  const machineIds = await mobileMachineIds(s, session);
  const calendarState = actionReportCalendarState(new URL(request.url).searchParams.get("month") ?? undefined, undefined);
  if (machineIds?.length === 0) return Response.json({ records: [], calendar: [], month: calendarState.month }, { headers: { "cache-control": "no-store" } });
  let query = s.from("service_action_reports")
    .select("id,client_uuid,machine_id,occurred_at,status,revision,action_kind,action_modes,provenance_status,notes,machines(name,display_name),service_action_report_incidents(incident_id)")
    .neq("status", "draft").order("occurred_at", { ascending: false }).limit(50);
  if (session.role !== "admin") query = query.eq("operator_id", session.id);
  if (machineIds) query = query.in("machine_id", machineIds);
  let calendarQuery = s.from("service_action_reports")
    .select("id,operator_id,machine_id,occurred_at,status,action_kind,action_modes,machines(name,display_name)")
    .neq("status", "draft").gte("occurred_at", calendarState.rangeFrom).lt("occurred_at", calendarState.rangeTo).order("occurred_at");
  if (session.role !== "admin") calendarQuery = calendarQuery.eq("operator_id", session.id);
  if (machineIds) calendarQuery = calendarQuery.in("machine_id", machineIds);
  const [{ data, error }, { data: calendarData, error: calendarError }] = await Promise.all([query, calendarQuery]);
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  if (calendarError) return Response.json({ error: { message: calendarError.message } }, { status: 500 });
  const records = ((data as Record<string, unknown>[]) ?? []).map((row) => {
    const machine = (Array.isArray(row.machines) ? row.machines[0] : row.machines) as { name: string; display_name: string | null } | null;
    return {
      report_id: row.id, client_uuid: row.client_uuid, machine_id: row.machine_id,
      machine_name: machine?.display_name || machine?.name || "Unknown machine",
      occurred_at: row.occurred_at, status: row.status, revision: row.revision,
      action_kind: row.action_kind, action_modes: parseActionReportModes(row.action_modes, row.action_kind) ?? modesFromLegacyKind(row.action_kind),
      provenance_status: row.provenance_status, notes: row.notes,
      incident_ids: ((row.service_action_report_incidents as { incident_id: string }[]) ?? []).map((link) => link.incident_id).sort(),
    };
  });
  const calendar = ((calendarData as Record<string, unknown>[]) ?? []).map((row) => {
      const machine = (Array.isArray(row.machines) ? row.machines[0] : row.machines) as { name: string; display_name: string | null } | null;
      return { report_id: row.id, machine_id: row.machine_id, machine_name: machine?.display_name || machine?.name || "Unknown machine", occurred_at: row.occurred_at, day: ymd(new Date(row.occurred_at as string), DEFAULT_TZ), status: row.status, action_kind: row.action_kind, action_modes: parseActionReportModes(row.action_modes, row.action_kind) ?? modesFromLegacyKind(row.action_kind) };
    });
  return Response.json({ records, calendar, month: calendarState.month }, { headers: { "cache-control": "no-store" } });
}
