import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";
import { latestRecallRows } from "@/lib/data/recall";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ lot: string }> }) {
  const { lot } = await params;
  const lotName = decodeURIComponent(lot);

  if (!isSupabaseConfigured()) {
    return Response.json({ lot_name: lotName, affected_machines: [] });
  }
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "recall.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });

  try {
    const s = await createServiceClient();
    // Find all machines that loaded this lot (from the lot audit trail)
    const [{ data, error }, { data: actionLines, error: actionError }] = await Promise.all([
      s.from("lot_usages")
        .select("machine_id,machine_name,device_imei,device_event_time,product_name,machines(name,last_full_clean_date)")
        .eq("lot_name", lotName).order("device_event_time", { ascending: false }),
      s.from("service_action_refill_lines")
        .select("product_name,service_action_reports!inner(machine_id,occurred_at,status,machines(name,device_imei,last_full_clean_date))")
        .eq("observed_lot_code", lotName).neq("provenance_status", "voided")
        .eq("service_action_reports.status", "confirmed"),
    ]);
    if (error) throw error;
    if (actionError) throw actionError;

    const canonicalRows = ((actionLines as Record<string, unknown>[]) ?? []).map((line) => {
      const report = line.service_action_reports as { machine_id: string; occurred_at: string; machines: { name?: string; device_imei?: string; last_full_clean_date?: string | null } | null };
      return { machine_id: report.machine_id, machine_name: report.machines?.name, device_imei: report.machines?.device_imei, device_event_time: report.occurred_at, product_name: line.product_name, machines: report.machines };
    });
    const allowedIds = await mobileMachineIds(s, session);
    const affected = latestRecallRows((data as Record<string, unknown>[]) ?? [], canonicalRows, allowedIds).map((r) => {
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
