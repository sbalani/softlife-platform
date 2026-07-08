import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  if (!isSupabaseConfigured()) return Response.json([]);
  try {
    const s = await createServiceClient();
    const { data } = await s.from("v_machines").select("*").order("name");
    const machines = (data ?? []).map((m: Record<string, unknown>) => ({
      // The real Supabase uuid — device_id_huaxin isn't a stable/unique
      // integer (every machine used to collapse to id 0 here).
      id: m.id,
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
