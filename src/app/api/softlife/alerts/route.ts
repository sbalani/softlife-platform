import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  if (!isSupabaseConfigured()) return Response.json([]);
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("alerts")
      .select("*")
      .neq("type", "change_out_of_range")
      .order("created_at", { ascending: false })
      .limit(50);
    return Response.json(data ?? []);
  } catch {
    return Response.json([]);
  }
}
