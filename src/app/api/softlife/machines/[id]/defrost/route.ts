import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATES = ["scheduled", "thawing", "thaw_closed", "refrigeration_check", "forming", "sales_check", "recovery"];
const RUN_FIELDS = "id,machine_id,state,trigger_kind,scheduled_for,started_at,completed_at,next_action_at,last_formation_pct,refrigeration_attempts,sales_attempts,failure_detail,outcome";

async function authorizedMachine(request: Request, rawId: string) {
  if (!isSupabaseConfigured()) return { response: Response.json({ error: { message: "Not configured" } }, { status: 503 }) };
  const session = await getApiSession(request);
  if (!session) return { response: Response.json({ error: { message: "Unauthorized" } }, { status: 401 }) };
  if (!hasMobileCapability(session, "defrost.run")) return { response: Response.json({ error: { message: "Forbidden" } }, { status: 403 }) };
  const machineId = rawId.toLowerCase();
  if (!UUID_RE.test(machineId)) return { response: Response.json({ error: { message: "Invalid machine ID" } }, { status: 400 }) };
  const service = await createServiceClient();
  if (!await canAccessMobileMachine(service, session, machineId, new Date().toISOString())) {
    return { response: Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 }) };
  }
  const { data: machine, error } = await service.from("machines").select("id,name,display_name,deployed,device_imei").eq("id", machineId).maybeSingle();
  if (error) throw error;
  if (!machine) return { response: Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 }) };
  return { session, service, machine };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authorizedMachine(request, (await params).id);
    if ("response" in result) return result.response;
    const [scheduleResult, runsResult] = await Promise.all([
      result.service.from("machine_defrost_schedules").select("defrost_seconds,formation_timeout_seconds,requires_intervention").eq("machine_id", result.machine.id).maybeSingle(),
      result.service.from("machine_defrost_runs").select(RUN_FIELDS).eq("machine_id", result.machine.id).order("created_at", { ascending: false }).limit(10),
    ]);
    if (scheduleResult.error) throw scheduleResult.error;
    if (runsResult.error) throw runsResult.error;
    const runs = runsResult.data ?? [];
    return Response.json({
      machine_id: result.machine.id,
      schedule: scheduleResult.data ? {
        defrost_seconds: Number(scheduleResult.data.defrost_seconds),
        formation_timeout_seconds: Number(scheduleResult.data.formation_timeout_seconds),
        requires_intervention: Boolean(scheduleResult.data.requires_intervention),
      } : null,
      active_run: runs.find((run) => ACTIVE_STATES.includes(String(run.state))) ?? null,
      runs,
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authorizedMachine(request, (await params).id);
    if ("response" in result) return result.response;
    const body = await request.json().catch(() => null) as { request_id?: unknown } | null;
    const requestId = typeof body?.request_id === "string" ? body.request_id.toLowerCase() : "";
    if (!UUID_RE.test(requestId)) return Response.json({ error: { message: "Invalid request_id" } }, { status: 400 });
    const existing = await result.service.from("machine_defrost_runs").select(RUN_FIELDS).eq("request_id", requestId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.machine_id !== result.machine.id) {
      return Response.json({ error: { message: "request_id is already used for another machine" } }, { status: 409 });
    }
    if (existing.data) return Response.json({ ok: true, duplicate: true, run: existing.data });
    const { data, error } = await result.service.rpc("request_manual_defrost", {
      p_machine_id: result.machine.id,
      p_admin_id: result.session.id,
      p_request_id: requestId,
    });
    if (error) {
      const conflict = /deployed|IMEI|duration|intervention|command is in progress|already active/i.test(error.message);
      return Response.json({ error: { message: error.message } }, { status: conflict ? 409 : 500 });
    }
    return Response.json({ ok: true, duplicate: false, run: data }, { status: 202 });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
