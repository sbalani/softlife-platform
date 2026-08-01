import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { accessibleMachineIds } from "@/lib/data/service-access";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ lot: string }> }) {
  const { lot } = await params;
  const lotName = decodeURIComponent(lot);

  if (!isSupabaseConfigured()) {
    return Response.json({ lot_name: lotName, affected_machines: [] });
  }
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });

  try {
    const s = await createServiceClient();
    // Find all machines that loaded this lot (from the lot audit trail)
    const { data, error } = await s
      .from("lot_usages")
      .select("machine_id,machine_name,device_imei,device_event_time,product_name,machines(name,last_full_clean_date)")
      .eq("lot_name", lotName)
      .order("device_event_time", { ascending: false });
    if (error) throw error;

    let rows = (data as Record<string, unknown>[]) ?? [];
    const allowedIds = await accessibleMachineIds(s, { role: session.role, tenant_id: session.tenantId });
    if (allowedIds) rows = rows.filter((row) => allowedIds.includes(row.machine_id as string));
    const latestByMachine = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = String(row.machine_id ?? row.device_imei ?? row.machine_name);
      if (!latestByMachine.has(key)) latestByMachine.set(key, row);
    }
    const affected = [...latestByMachine.values()].map((r) => {
      const machine = r.machines as { name?: string; last_full_clean_date?: string | null } | null;
      return {
        machine_id: r.machine_id,
        machine_name: machine?.name ?? (r.machine_name as string) ?? (r.device_imei as string) ?? "Unknown",
        partner_name: null,
        last_lot_added_date: r.device_event_time,
        last_full_clean_date: machine?.last_full_clean_date ?? null,
        disposition: "hold",
      };
    });

    return Response.json({ lot_name: lotName, affected_machines: affected });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
