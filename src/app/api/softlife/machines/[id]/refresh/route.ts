import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { getConfigFromEnv } from "@/lib/huaxin/client";
import { parseMachineRefreshClaim, presentRefreshComponents, readMachineRefreshFreshness, refreshHuaxinMachine } from "@/lib/data/huaxin-machine-refresh";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "machines.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const id = (await params).id.toLowerCase();
  if (!UUID_RE.test(id)) return Response.json({ error: { message: "Invalid machine ID" } }, { status: 400 });

  try {
    const service = await createServiceClient();
    const notFound = () => Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 });
    if (!await canAccessMobileMachine(service, session, id, new Date().toISOString())) return notFound();
    const { data, error } = await service.from("machines").select("id,name,device_imei").eq("id", id).maybeSingle();
    if (error) throw error;
    const machine = data as { id: string; name: string | null; device_imei: string | null } | null;
    if (!machine) return notFound();
    if (!machine.device_imei) return Response.json({ error: { message: "Machine is not available for refresh" } }, { status: 409 });
    const cfg = getConfigFromEnv();
    if (!cfg) return Response.json({ error: { message: "Huaxin not configured" } }, { status: 503 });

    const owner = crypto.randomUUID();
    const { data: claimData, error: claimError } = await service.rpc("claim_huaxin_machine_refresh", { p_machine_id: id, p_owner: owner });
    if (claimError) throw claimError;
    const claim = parseMachineRefreshClaim(claimData);
    if (!claim.claimed) {
      const current = await readMachineRefreshFreshness(service, id, machine.device_imei);
      const status = claim.reason === "cooldown" ? 429 : 409;
      const message = claim.reason === "cooldown" ? "Machine refresh is cooling down" : "A machine refresh is already in progress";
      return Response.json({
        ok: false,
        machine_id: id,
        partial: false,
        error: { code: `refresh_${claim.reason}`, message, retry_after_seconds: claim.retry_after_seconds },
        refresh: { started_at: null, finished_at: null, ...presentRefreshComponents({ status: "skipped", menu: "skipped" }, current) },
      }, { status, headers: { "Retry-After": String(claim.retry_after_seconds) } });
    }

    let success = false;
    try {
      const result = await refreshHuaxinMachine(service, cfg, { ...machine, device_imei: machine.device_imei }, { id: session.id, email: session.email }, owner);
      success = result.ok;
      return Response.json({ machine_id: id, ...result }, { status: result.ok ? 200 : 502 });
    } finally {
      const { error: releaseError } = await service.rpc("release_huaxin_machine_refresh", { p_machine_id: id, p_owner: owner, p_succeeded: success });
      if (releaseError) console.error(`[mobile-refresh] Could not release ${id}:`, releaseError);
    }
  } catch (error) {
    console.error("[mobile-refresh] Request failed:", error);
    return Response.json({ error: { message: "Could not refresh machine" } }, { status: 500 });
  }
}
