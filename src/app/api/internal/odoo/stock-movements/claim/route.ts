import { isOdooSyncAuthorized } from "@/lib/auth/odoo-sync";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isOdooSyncAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  try {
    const body = await request.json() as { worker?: unknown; limit?: unknown };
    if (typeof body.worker !== "string" || !body.worker.trim()) return Response.json({ error: "Worker lease token is required" }, { status: 400 });
    const limit = Number(body.limit ?? 20);
    const s = await createServiceClient();
    const { data, error } = await s.rpc("claim_warehouse_stock_movements", { p_worker: body.worker, p_limit: Number.isInteger(limit) ? limit : 20 });
    if (error) throw error;
    return Response.json({ movements: data ?? [] });
  } catch (error) {
    console.error("[odoo-stock-claim]", error);
    return Response.json({ error: "Unable to claim stock movements" }, { status: 500 });
  }
}
