import { isOdooSyncAuthorized } from "@/lib/auth/odoo-sync";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isOdooSyncAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  try {
    const body = await request.json() as { rows?: unknown; product_rows?: unknown; reflected_references?: unknown; observed_at?: unknown };
    if (!Array.isArray(body.rows) || !Array.isArray(body.product_rows) || !Array.isArray(body.reflected_references)
      || body.reflected_references.some((reference) => typeof reference !== "string") || typeof body.observed_at !== "string") return Response.json({ error: "Invalid stock snapshot" }, { status: 400 });
    const s = await createServiceClient();
    const { error } = await s.rpc("replace_odoo_stock_snapshot_v4", {
      p_lot_payload: body.rows, p_product_payload: body.product_rows, p_reflected_references: body.reflected_references, p_observed_at: body.observed_at,
    });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[odoo-stock-snapshot]", error);
    return Response.json({ error: "Unable to replace stock snapshot" }, { status: 500 });
  }
}
