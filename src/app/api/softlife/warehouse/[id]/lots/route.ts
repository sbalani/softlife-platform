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
    const [{ data: stockRows, error: stockError }, { data: legacyRows, error: legacyError }, { data: mirrorState, error: stateError }] = await Promise.all([
      s.from("warehouse_lot_effective_balances").select("odoo_lot_id,effective_quantity").eq("odoo_warehouse_id", warehouseId).gt("effective_quantity", 0),
      s.from("odoo_lots").select("odoo_id,name,odoo_product_id,product_name,qty,expiration_date").eq("odoo_warehouse_id", warehouseId).gt("qty", 0),
      s.from("odoo_mirror_state").select("key").eq("key", "lot_stock").maybeSingle(),
    ]);
    if (stockError) throw stockError;
    if (legacyError) throw legacyError;
    if (stateError) throw stateError;
    let rows = mirrorState ? [] : (legacyRows as Record<string, unknown>[]) ?? [];
    if (mirrorState && stockRows?.length) {
      const stock = stockRows as { odoo_lot_id: number; effective_quantity: number }[];
      const { data: masterRows, error: masterError } = await s.from("odoo_lots")
        .select("odoo_id,name,odoo_product_id,product_name,expiration_date").in("odoo_id", stock.map((row) => row.odoo_lot_id));
      if (masterError) throw masterError;
      const masters = new Map(((masterRows as Record<string, unknown>[]) ?? []).map((row) => [row.odoo_id as number, row]));
      rows = stock.flatMap((row) => masters.has(row.odoo_lot_id) ? [{ ...masters.get(row.odoo_lot_id)!, qty: row.effective_quantity }] : []);
    }
    const lots = rows.map((lot) => ({
      id: String(lot.odoo_id),
      name: lot.name,
      product_id: lot.odoo_product_id == null ? null : String(lot.odoo_product_id),
      product_name: lot.product_name ?? null,
      qty_available: Math.max(0, Number(lot.qty ?? 0)),
      device_event_time: null,
      expiration_date: lot.expiration_date ?? null,
      disposition: "released",
    })).filter((lot) => lot.qty_available > 0)
      .sort((a, b) => String(a.expiration_date ?? "9999").localeCompare(String(b.expiration_date ?? "9999")) || String(a.name).localeCompare(String(b.name)));
    return Response.json({ warehouse_id: warehouseId, lots });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
