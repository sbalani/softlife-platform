import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  if (!isSupabaseConfigured()) return Response.json([]);
  try {
    const s = await createServiceClient();
    const { data } = await s.from("v_machines").select("*").order("name");
    const machines = (data ?? []).map((m: Record<string, unknown>) => ({
      id: parseInt(String(m.device_id_huaxin ?? "0")) || 0,
      name: m.name,
      partner_id: 0,
      partner_name: m.customer ?? null,
      location_id: 0,
      last_full_clean_date: m.last_full_clean_date ?? null,
    }));
    return Response.json(machines);
  } catch {
    return Response.json([]);
  }
}
