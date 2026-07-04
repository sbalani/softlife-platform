import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return Response.json({ warehouse_id: parseInt(id), lots: [] });
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("lots")
      .select("*")
      .order("device_event_time", { ascending: true, nullsFirst: false });
    const lots = (data ?? []).map((l: Record<string, unknown>, i: number) => ({
      id: i + 1,
      name: l.name,
      product_id: 0,
      product_name: l.product_name ?? null,
      qty_available: Number(l.qty_available ?? 0),
      device_event_time: l.device_event_time ?? null,
      disposition: l.disposition ?? "released",
    }));
    return Response.json({ warehouse_id: parseInt(id), lots });
  } catch {
    return Response.json({ warehouse_id: parseInt(id), lots: [] });
  }
}
