import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, sendCommand } from "@/lib/huaxin/client";
import { FRANCHISEE_CONFIGURABLE_COMMANDS, HUAXIN_REMOTE_COMMANDS } from "@/lib/huaxin/remote-commands";
import type { MobileSession } from "@/lib/auth/mobile-authorization";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function commandsFor(s: SupabaseClient, session: MobileSession) {
  if (session.role === "admin") return HUAXIN_REMOTE_COMMANDS;
  if (session.role !== "franchisee" || !session.tenantId) return [];
  const { data, error } = await s.from("tenants").select("remote_commands").eq("id", session.tenantId).maybeSingle();
  if (error) throw error;
  const allowed = new Set((data?.remote_commands as string[] | null) ?? ["operate_make"]);
  return FRANCHISEE_CONFIGURABLE_COMMANDS.filter((item) => allowed.has(item.command));
}

async function authorizedMachine(req: Request, rawId: string) {
  if (!isSupabaseConfigured()) return { response: Response.json({ error: { message: "Not configured" } }, { status: 503 }) };
  const session = await getApiSession(req);
  if (!session) return { response: Response.json({ error: { message: "Unauthorized" } }, { status: 401 }) };
  if (!hasMobileCapability(session, "remote.basic")) return { response: Response.json({ error: { message: "Forbidden" } }, { status: 403 }) };
  const id = rawId.toLowerCase();
  if (!UUID_RE.test(id)) return { response: Response.json({ error: { message: "Invalid machine ID" } }, { status: 400 }) };
  const service = await createServiceClient();
  if (!await canAccessMobileMachine(service, session, id, new Date().toISOString())) {
    return { response: Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 }) };
  }
  const { data, error } = await service.from("machines").select("id,name,display_name,device_imei").eq("id", id).maybeSingle();
  if (error) throw error;
  const machine = data as { id: string; name: string; display_name: string | null; device_imei: string | null } | null;
  if (!machine?.device_imei) return { response: Response.json({ error: { message: "Machine is not available for remote control" } }, { status: 409 }) };
  return { session, service, machine };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authorizedMachine(req, (await params).id);
    if ("response" in result) return result.response;
    const commands = await commandsFor(result.service, result.session);
    return Response.json({
      machine_id: result.machine.id,
      commands: commands.map(({ command, label, note }) => ({ command, label, note })),
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authorizedMachine(req, (await params).id);
    if ("response" in result) return result.response;
    const body = await req.json().catch(() => null) as { command?: unknown } | null;
    const command = typeof body?.command === "string" ? body.command : "";
    const commands = await commandsFor(result.service, result.session);
    if (!commands.some((item) => item.command === command)) {
      return Response.json({ error: { message: "Command not allowed" } }, { status: 403 });
    }
    const cfg = getConfigFromEnv();
    if (!cfg) return Response.json({ error: { message: "Huaxin not configured" } }, { status: 503 });
    try {
      const response = await sendCommand(cfg, result.machine.device_imei!, command);
      const code = String(response.code);
      const message = response.msg ?? "";
      await result.service.from("machine_change_log").insert({
        machine_id: result.machine.id,
        device_imei: result.machine.device_imei,
        machine_name: result.machine.display_name || result.machine.name,
        source: "platform",
        action: "remote_command",
        entity_type: "machine",
        entity_key: result.machine.id,
        field: command,
        new_value: { code, message },
        actor_id: result.session.id,
        actor_email: result.session.email,
        metadata: { source: "mobile", role: result.session.role },
      });
      if (code !== "200") return Response.json({ error: { message: message || "Command rejected" }, code }, { status: 502 });
      return Response.json({ ok: true, code, message: message || "success" });
    } catch (error) {
      await result.service.from("machine_change_log").insert({
        machine_id: result.machine.id,
        device_imei: result.machine.device_imei,
        machine_name: result.machine.display_name || result.machine.name,
        source: "platform",
        action: "remote_command_failed",
        entity_type: "machine",
        entity_key: result.machine.id,
        field: command,
        actor_id: result.session.id,
        actor_email: result.session.email,
        metadata: { source: "mobile", role: result.session.role, error: error instanceof Error ? error.message : String(error) },
      });
      return Response.json({ error: { message: "The command could not be confirmed. Do not retry automatically." } }, { status: 502 });
    }
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
