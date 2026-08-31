import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { presentMachineStatuses, type MachineStatusSnapshot } from "@/lib/data/mobile-machine-status";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "machines.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const id = (await params).id.toLowerCase();
  if (!UUID_RE.test(id)) return Response.json({ error: { message: "Invalid machine ID" } }, { status: 400 });
  try {
    const service = await createServiceClient();
    if (!await canAccessMobileMachine(service, session, id, new Date().toISOString())) {
      return Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 });
    }
    const [{ data: machine, error: machineError }, initialStatusResult] = await Promise.all([
      service.from("machines").select("id,name,device_imei").eq("id", id).maybeSingle(),
      service.from("machine_status_snapshots").select("field,raw,observed_at").eq("machine_id", id).like("field", "raw:%"),
    ]);
    if (machineError) throw machineError;
    if (!machine) return Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 });
    if (initialStatusResult.error) throw initialStatusResult.error;
    const rows = (initialStatusResult.data as MachineStatusSnapshot[]) ?? [];
    return Response.json({ machine_id: id, ...presentMachineStatuses(rows) });
  } catch (error) {
    console.error(`[mobile-status] Request failed:`, error);
    return Response.json({ error: { message: "Could not load machine status" } }, { status: 500 });
  }
}
