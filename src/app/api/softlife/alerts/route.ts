import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "alerts.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    const s = await createServiceClient();
    const allowedIds = await mobileMachineIds(s, session);
    if (allowedIds?.length === 0) return Response.json([]);
    let query = s.from("alerts").select("id,type,severity,machine_id,title,message,remaining_pct,created_at,machines(name,display_name)")
      .is("resolved_at", null).neq("type", "change_out_of_range")
      .order("created_at", { ascending: false }).limit(50);
    if (allowedIds) query = query.in("machine_id", allowedIds);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json((data as Record<string, unknown>[] ?? []).map((alert) => ({
      ...alert,
      machine_name: (alert.machines as { name?: string; display_name?: string | null } | null)?.display_name ?? (alert.machines as { name?: string } | null)?.name ?? null,
      machines: undefined,
    })));
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
