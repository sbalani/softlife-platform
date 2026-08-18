import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type WarehouseOption = { id: number; name: string };
export type InventoryLotOption = { id: number; name: string; productName: string; stockUnit: string };
export type EffectiveBalance = {
  warehouseId: number; warehouseName: string; lotId: number; lotName: string; productName: string;
  mirrorQuantity: number; platformOverlay: number; legacyReserved: number; effectiveQuantity: number;
};
export type StockMovement = {
  id: string; kind: string; warehouseName: string; lotName: string; quantity: number; occurredAt: string;
  reason: string | null; syncStatus: string; syncError: string | null;
};
export type ConfirmedAllocation = { id: string; machineName: string; lotName: string; quantity: number; stockQuantity: number; stockUnit: string; confirmedAt: string };

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function getInventoryReconciliation() {
  if (!isSupabaseConfigured()) return { warehouses: [], lots: [], balances: [], movements: [], allocations: [] };
  const s = await createServiceClient();
  const [{ data: warehouses, error: warehouseError }, { data: lots, error: lotError }, { data: balances, error: balanceError }, { data: movements, error: movementError }, { data: allocations, error: allocationError }] = await Promise.all([
    s.from("odoo_warehouses").select("odoo_id,name").order("name"),
    s.from("odoo_lots").select("odoo_id,name,product_name,odoo_products(uom)").order("name"),
    s.from("warehouse_lot_effective_balances").select("*"),
    s.from("warehouse_stock_movements").select("id,movement_kind,odoo_warehouse_id,odoo_lot_id,quantity,occurred_at,reason,warehouse_stock_movement_sync(status,last_error)").order("occurred_at", { ascending: false }).limit(100),
    s.from("refill_stock_allocations").select("id,odoo_lot_id,quantity,stock_quantity,stock_unit,confirmed_at,service_action_refill_lines(service_action_reports(machines(name,display_name)))").eq("status", "confirmed").order("confirmed_at", { ascending: false }).limit(50),
  ]);
  if (warehouseError) throw warehouseError;
  if (lotError) throw lotError;
  if (balanceError) throw balanceError;
  if (movementError) throw movementError;
  if (allocationError) throw allocationError;
  const warehouseRows = (warehouses as { odoo_id: number; name: string }[]) ?? [];
  const lotRows = (lots as unknown as { odoo_id: number; name: string; product_name: string | null; odoo_products: { uom: string | null } | { uom: string | null }[] | null }[]) ?? [];
  const warehouseNames = new Map(warehouseRows.map((row) => [row.odoo_id, row.name]));
  const lotById = new Map(lotRows.map((row) => [row.odoo_id, row]));
  return {
    warehouses: warehouseRows.map((row) => ({ id: row.odoo_id, name: row.name })) as WarehouseOption[],
    lots: lotRows.map((row) => ({ id: row.odoo_id, name: row.name, productName: row.product_name ?? "Unknown product", stockUnit: relatedOne(row.odoo_products)?.uom ?? "unit" })) as InventoryLotOption[],
    balances: ((balances as Record<string, unknown>[]) ?? []).map((row) => {
      const lot = lotById.get(row.odoo_lot_id as number);
      return {
        warehouseId: row.odoo_warehouse_id as number,
        warehouseName: warehouseNames.get(row.odoo_warehouse_id as number) ?? String(row.odoo_warehouse_id),
        lotId: row.odoo_lot_id as number,
        lotName: lot?.name ?? String(row.odoo_lot_id),
        productName: lot?.product_name ?? "Unknown product",
        mirrorQuantity: Number(row.mirror_quantity),
        platformOverlay: Number(row.platform_overlay),
        legacyReserved: Number(row.legacy_reserved),
        effectiveQuantity: Number(row.effective_quantity),
      };
    }) as EffectiveBalance[],
    movements: ((movements as Record<string, unknown>[]) ?? []).map((row) => {
      const lot = lotById.get(row.odoo_lot_id as number);
      const sync = row.warehouse_stock_movement_sync as { status: string; last_error: string | null } | null;
      return {
        id: row.id as string,
        kind: row.movement_kind as string,
        warehouseName: warehouseNames.get(row.odoo_warehouse_id as number) ?? String(row.odoo_warehouse_id),
        lotName: lot?.name ?? String(row.odoo_lot_id),
        quantity: Number(row.quantity),
        occurredAt: row.occurred_at as string,
        reason: row.reason as string | null,
        syncStatus: sync?.status ?? "unknown",
        syncError: sync?.last_error ?? null,
      };
    }) as StockMovement[],
    allocations: ((allocations as Record<string, unknown>[]) ?? []).map((row) => {
      const line = row.service_action_refill_lines as { service_action_reports: { machines: { name: string; display_name: string | null } | null } | null } | null;
      const machine = line?.service_action_reports?.machines;
      return { id: row.id as string, machineName: machine?.display_name || machine?.name || "Unknown machine", lotName: lotById.get(row.odoo_lot_id as number)?.name ?? String(row.odoo_lot_id), quantity: Number(row.quantity), stockQuantity: Number(row.stock_quantity), stockUnit: row.stock_unit as string, confirmedAt: row.confirmed_at as string };
    }) as ConfirmedAllocation[],
  };
}
