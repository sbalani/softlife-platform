import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMachine } from "@/lib/data/service-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ accepted: [], rejected: [] });
  }
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const body = await req.json();
  const records: Record<string, unknown>[] = body.records ?? [];

  try {
    const s = await createServiceClient();
    const accepted: string[] = [];
    const rejected: { client_uuid: string; reason: string }[] = [];

    for (const r of records) {
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
      if (!await canAccessMachine(s, { role: session.role, tenant_id: session.tenantId }, submittedMachineId, eventTime)) {
        rejected.push({ client_uuid: clientUuid, reason: "Machine access denied" });
        continue;
      }
      const { error } = await s.rpc("record_refill", {
        p_client_uuid: clientUuid,
        p_machine_id: submittedMachineId,
        p_operator_id: session.id,
        p_device_event_time: eventTime,
        p_payload: { ...r, operator_id: session.id },
      });
      if (error) {
        rejected.push({ client_uuid: clientUuid, reason: error.message });
        continue;
      }
      accepted.push(clientUuid);
    }

    return Response.json({ accepted, rejected });
  } catch (e) {
    return Response.json(
      { accepted: [], rejected: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
