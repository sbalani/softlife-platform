import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const warehouseId = Number((await params).id);
  if (!Number.isInteger(warehouseId) || warehouseId < 1) return Response.json({ error: { message: "Invalid warehouse" } }, { status: 400 });
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "service.refill")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    const s = await createServiceClient();
    const allowedIds = await mobileMachineIds(s, session);
    if (allowedIds?.length === 0) return Response.json({ error: { message: "Warehouse access denied" } }, { status: 403 });
    let machineQuery = s.from("machines").select("id").eq("odoo_warehouse_id", warehouseId).limit(1);
    if (allowedIds) machineQuery = machineQuery.in("id", allowedIds);
    const { data: machine, error: machineError } = await machineQuery.maybeSingle();
    if (machineError) throw machineError;
    if (!machine) return Response.json({ error: { message: "Warehouse access denied" } }, { status: 403 });
    const { data, error } = await s.from("odoo_lots")
      .select("odoo_id,name,odoo_product_id,product_name,qty,expiration_date")
      .eq("odoo_warehouse_id", warehouseId).gt("qty", 0)
      .order("expiration_date", { ascending: true, nullsFirst: false }).order("name");
    if (error) throw error;
    const { data: pendingRefills, error: refillError } = await s.from("reposiciones").select("id").in("odoo_sync_status", ["pending", "failed"]);
    if (refillError) throw refillError;
    const refillIds = ((pendingRefills as { id: string }[]) ?? []).map((row) => row.id);
    const reserved = new Map<number, number>();
    if (refillIds.length) {
      const { data: usages, error: usageError } = await s.from("lot_usages").select("odoo_lot_id,quantity").in("reposicion_id", refillIds).not("odoo_lot_id", "is", null);
      if (usageError) throw usageError;
      for (const usage of (usages as { odoo_lot_id: number; quantity: number }[]) ?? []) reserved.set(usage.odoo_lot_id, (reserved.get(usage.odoo_lot_id) ?? 0) + Number(usage.quantity ?? 0));
    }
    const lots = (data ?? []).map((lot: Record<string, unknown>) => ({
      id: String(lot.odoo_id),
      name: lot.name,
      product_id: lot.odoo_product_id == null ? null : String(lot.odoo_product_id),
      product_name: lot.product_name ?? null,
      qty_available: Math.max(0, Number(lot.qty ?? 0) - (reserved.get(lot.odoo_id as number) ?? 0)),
      device_event_time: null,
      expiration_date: lot.expiration_date ?? null,
      disposition: "released",
    })).filter((lot) => lot.qty_available > 0);
    return Response.json({ warehouse_id: warehouseId, lots });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
