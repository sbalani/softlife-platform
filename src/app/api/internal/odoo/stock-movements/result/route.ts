import { isOdooSyncAuthorized } from "@/lib/auth/odoo-sync";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isOdooSyncAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  try {
    const body = await request.json() as { movement_id?: unknown; worker?: unknown; lease_token?: unknown; accepted?: unknown; odoo_external_id?: unknown; error?: unknown; retry_at?: unknown };
    if (typeof body.movement_id !== "string" || typeof body.worker !== "string" || typeof body.lease_token !== "string" || typeof body.accepted !== "boolean") return Response.json({ error: "Invalid movement result" }, { status: 400 });
    const s = await createServiceClient();
    const { error } = await s.rpc("record_warehouse_stock_movement_result", {
      p_movement_id: body.movement_id,
      p_worker: body.worker,
      p_lease_token: body.lease_token,
      p_accepted: body.accepted,
      p_odoo_external_id: typeof body.odoo_external_id === "string" ? body.odoo_external_id : null,
      p_error: typeof body.error === "string" ? body.error.slice(0, 5000) : null,
      p_retry_at: typeof body.retry_at === "string" ? body.retry_at : null,
    });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[odoo-stock-result]", error);
    return Response.json({ error: "Unable to record stock movement result" }, { status: 500 });
  }
}
