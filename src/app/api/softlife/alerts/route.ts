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
    let query = s.from("v_alerts").select("id,type,severity,machine_id,title,message,remaining_pct,created_at,machine_name")
      .is("resolved_at", null).neq("type", "change_out_of_range")
      .order("created_at", { ascending: false }).limit(50);
    query = allowedIds ? query.in("machine_id", allowedIds) : query.or("machine_id.is.null,machine_deployed.eq.true,type.eq.defrost_automation_failed");
    const { data, error } = await query;
    if (error) throw error;
    return Response.json(data ?? []);
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
