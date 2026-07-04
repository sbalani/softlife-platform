import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ lot: string }> }) {
  const { lot } = await params;
  const lotName = decodeURIComponent(lot);

  if (!isSupabaseConfigured()) {
    return Response.json({ lot_name: lotName, affected_machines: [] });
  }

  try {
    const s = await createServiceClient();
    // Find all machines that loaded this lot (from the lot audit trail)
    const { data } = await s
      .from("lot_usages")
      .select("machine_name,device_imei,device_event_time,product_name")
      .eq("lot_name", lotName)
      .order("device_event_time", { ascending: false });

    const affected = (data ?? []).map((r: Record<string, unknown>) => ({
      machine_id: 0,
      machine_name: (r.machine_name as string) ?? (r.device_imei as string) ?? "Unknown",
      partner_name: null,
      last_lot_added_date: r.device_event_time,
      last_full_clean_date: null,
      disposition: "hold",
    }));

    return Response.json({ lot_name: lotName, affected_machines: affected });
  } catch {
    return Response.json({ lot_name: lotName, affected_machines: [] });
  }
}
