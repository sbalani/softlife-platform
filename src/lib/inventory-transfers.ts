import type { SupabaseClient } from "@supabase/supabase-js";
import { combinedTransferStatus, InventoryTransferValidationError, type InventoryTransferInput } from "./inventory-transfer-contract";
import { createServiceClient, isSupabaseConfigured } from "./supabase/server";

export type InventoryTransferWorkspace = {
  sourceWarehouse: { id: number; name: string } | null;
  destinationWarehouses: { id: number; name: string }[];
  lots: { id: number; name: string; productName: string; stockUnit: string; quantity: number; expirationDate: string | null }[];
  transfers: { id: string; occurredAt: string; sourceWarehouse: string; destinationWarehouse: string; lotName: string; productName: string; quantity: number; reason: string; syncStatus: string; syncError: string | null }[];
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function getInventoryTransferWorkspace(client?: SupabaseClient): Promise<InventoryTransferWorkspace> {
  if (!client && !isSupabaseConfigured()) return { sourceWarehouse: null, destinationWarehouses: [], lots: [], transfers: [] };
  const s = client ?? await createServiceClient();
  const [{ data: settings, error: settingsError }, { data: warehouses, error: warehouseError }, { data: transferGroups, error: groupError }] = await Promise.all([
    s.from("production_settings").select("replenishment_source_odoo_warehouse_id").eq("singleton", true).maybeSingle(),
    s.from("odoo_warehouses").select("odoo_id,name").order("name"),
    s.from("warehouse_stock_movements").select("movement_group_id,occurred_at").eq("movement_kind", "transfer_out").order("occurred_at", { ascending: false }).limit(100),
  ]);
  if (settingsError) throw settingsError;
  if (warehouseError) throw warehouseError;
  if (groupError) throw groupError;
  const warehouseRows = (warehouses as { odoo_id: number; name: string }[]) ?? [];
  const sourceId = Number(settings?.replenishment_source_odoo_warehouse_id);
  const sourceRow = warehouseRows.find((warehouse) => warehouse.odoo_id === sourceId) ?? null;
  const sourceWarehouse = sourceRow ? { id: sourceRow.odoo_id, name: sourceRow.name } : null;
  const warehouseNames = new Map(warehouseRows.map((warehouse) => [warehouse.odoo_id, warehouse.name]));
  const groupIds = ((transferGroups as { movement_group_id: string }[]) ?? []).map((row) => row.movement_group_id);
  const [{ data: balances, error: balanceError }, { data: movements, error: movementError }] = await Promise.all([
    sourceWarehouse
      ? s.from("warehouse_lot_effective_balances").select("odoo_lot_id,effective_quantity").eq("odoo_warehouse_id", sourceWarehouse.id).gt("effective_quantity", 0)
      : Promise.resolve({ data: [], error: null }),
    groupIds.length
      ? s.from("warehouse_stock_movements").select("id,movement_group_id,movement_kind,odoo_warehouse_id,odoo_lot_id,quantity,occurred_at,reason,warehouse_stock_movement_sync(status,last_error)").in("movement_group_id", groupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (balanceError) throw balanceError;
  if (movementError) throw movementError;
  const movementRows = (movements as Record<string, unknown>[]) ?? [];
  const balanceRows = (balances as { odoo_lot_id: number; effective_quantity: number }[]) ?? [];
  const lotIds = [...new Set([...balanceRows.map((row) => row.odoo_lot_id), ...movementRows.map((row) => Number(row.odoo_lot_id))])].filter(Number.isInteger);
  const { data: lots, error: lotError } = lotIds.length
    ? await s.from("odoo_lots").select("odoo_id,name,product_name,expiration_date,odoo_products(uom)").in("odoo_id", lotIds)
    : { data: [], error: null };
  if (lotError) throw lotError;
  const lotById = new Map(((lots as Record<string, unknown>[]) ?? []).map((lot) => [Number(lot.odoo_id), lot]));
  const grouped = new Map<string, Record<string, unknown>[] >();
  for (const movement of movementRows) {
    const groupId = String(movement.movement_group_id ?? movement.id);
    grouped.set(groupId, [...(grouped.get(groupId) ?? []), movement]);
  }
  return {
    sourceWarehouse,
    destinationWarehouses: warehouseRows.filter((warehouse) => warehouse.odoo_id !== sourceId).map((warehouse) => ({ id: warehouse.odoo_id, name: warehouse.name })),
    lots: balanceRows.map((balance) => {
      const lot = lotById.get(balance.odoo_lot_id);
      const product = relatedOne(lot?.odoo_products as { uom?: string | null } | { uom?: string | null }[] | null);
      return { id: balance.odoo_lot_id, name: String(lot?.name ?? balance.odoo_lot_id), productName: String(lot?.product_name ?? "Unknown product"), stockUnit: product?.uom ?? "unit", quantity: Number(balance.effective_quantity), expirationDate: lot?.expiration_date ? String(lot.expiration_date) : null };
    }).sort((a, b) => String(a.expirationDate ?? "9999").localeCompare(String(b.expirationDate ?? "9999")) || a.name.localeCompare(b.name)),
    transfers: [...grouped].flatMap(([id, rows]) => {
      const outbound = rows.find((row) => row.movement_kind === "transfer_out");
      const inbound = rows.find((row) => row.movement_kind === "transfer_in");
      if (!outbound || !inbound) return [];
      const lot = lotById.get(Number(outbound.odoo_lot_id));
      const syncRows = rows.map((row) => relatedOne(row.warehouse_stock_movement_sync as { status: string; last_error: string | null } | { status: string; last_error: string | null }[] | null));
      return [{
        id,
        occurredAt: String(outbound.occurred_at),
        sourceWarehouse: warehouseNames.get(Number(outbound.odoo_warehouse_id)) ?? String(outbound.odoo_warehouse_id),
        destinationWarehouse: warehouseNames.get(Number(inbound.odoo_warehouse_id)) ?? String(inbound.odoo_warehouse_id),
        lotName: String(lot?.name ?? outbound.odoo_lot_id),
        productName: String(lot?.product_name ?? "Unknown product"),
        quantity: Math.abs(Number(outbound.quantity)),
        reason: String(outbound.reason ?? ""),
        syncStatus: combinedTransferStatus(syncRows.map((sync) => sync?.status ?? "unknown")),
        syncError: syncRows.map((sync) => sync?.last_error).find(Boolean) ?? null,
      }];
    }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
  };
}

export async function recordInventoryTransfer(s: SupabaseClient, actorId: string, input: InventoryTransferInput) {
  const { data: existing, error: existingError } = await s.from("warehouse_stock_movements")
    .select("movement_kind,odoo_warehouse_id,warehouse_stock_movement_sync(status)")
    .eq("movement_group_id", input.clientUuid);
  if (existingError) throw existingError;
  const existingRows = (existing as { movement_kind: string; odoo_warehouse_id: number; warehouse_stock_movement_sync: { status: string } | { status: string }[] | null }[]) ?? [];
  const existingOutbound = existingRows
    .find((movement) => movement.movement_kind === "transfer_out");
  if (existingOutbound) {
    const result = await invokeTransferRpc(s, actorId, input, existingOutbound.odoo_warehouse_id);
    return { movementIds: result.movementIds, created: false, status: combinedTransferStatus(existingRows.map((row) => relatedOne(row.warehouse_stock_movement_sync)?.status ?? "unknown")) };
  }

  const workspace = await getInventoryTransferWorkspace(s);
  if (!workspace.sourceWarehouse) throw new InventoryTransferValidationError("Configure the central stock warehouse in Odoo settings first.");
  if (!workspace.destinationWarehouses.some((warehouse) => warehouse.id === input.destinationWarehouseId)) throw new InventoryTransferValidationError("Select a valid destination warehouse.");
  const lot = workspace.lots.find((candidate) => candidate.id === input.lotId);
  if (!lot) throw new InventoryTransferValidationError("The selected lot has no available central stock.");
  if (input.quantity > lot.quantity) throw new InventoryTransferValidationError("Transfer exceeds effective central stock.");
  const result = await invokeTransferRpc(s, actorId, input, workspace.sourceWarehouse.id);
  return { movementIds: result.movementIds, created: result.created, status: "pending" };
}

async function invokeTransferRpc(s: SupabaseClient, actorId: string, input: InventoryTransferInput, sourceWarehouseId: number) {
  const { data, error } = await s.rpc("record_warehouse_transfer", {
    p_client_uuid: input.clientUuid,
    p_source_warehouse_id: sourceWarehouseId,
    p_destination_warehouse_id: input.destinationWarehouseId,
    p_odoo_lot_id: input.lotId,
    p_quantity: input.quantity,
    p_occurred_at: input.occurredAt,
    p_reason: input.reason,
    p_actor_id: actorId,
  });
  if (error) throw error;
  const result = data as { out_movement_id: string; in_movement_id: string; created?: boolean };
  return { movementIds: { out_movement_id: result.out_movement_id, in_movement_id: result.in_movement_id }, created: result.created !== false };
}
