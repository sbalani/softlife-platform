import type { SessionProfile } from "@/lib/auth/session";
import { canAccessMachine } from "@/lib/data/service-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ServiceLot = {
  odoo_id: number;
  name: string;
  product_name: string;
  available: number;
  expiration_date: string | null;
};

export type MachineService = {
  id: string;
  name: string;
  imei: string | null;
  warehouseId: number | null;
  warehouseName: string | null;
  lastFullClean: string | null;
  lots: ServiceLot[];
};

export async function getMachineService(machineId: string, session: SessionProfile): Promise<MachineService | null> {
  if (!isSupabaseConfigured()) return null;
  const s = await createServiceClient();
  if (!await canAccessMachine(s, session, machineId, new Date().toISOString())) return null;
  const { data: machine, error: machineError } = await s.from("machines")
    .select("id,name,display_name,device_imei,last_full_clean_date,odoo_warehouse_id,odoo_warehouses(name)")
    .eq("id", machineId).maybeSingle();
  if (machineError) throw machineError;
  if (!machine) return null;

  const warehouseId = (machine.odoo_warehouse_id as number) ?? null;
  let lots: ServiceLot[] = [];
  if (warehouseId) {
    const [{ data: stockRows, error: stockError }, { data: legacyLotRows, error: lotError }, { data: mirrorState, error: stateError }] = await Promise.all([
      s.from("warehouse_lot_effective_balances").select("odoo_lot_id,effective_quantity")
        .eq("odoo_warehouse_id", warehouseId).gt("effective_quantity", 0),
      s.from("odoo_lots").select("odoo_id,name,product_name,qty,expiration_date")
        .eq("odoo_warehouse_id", warehouseId).gt("qty", 0),
      s.from("odoo_mirror_state").select("key").eq("key", "lot_stock").maybeSingle(),
    ]);
    if (stockError) throw stockError;
    if (lotError) throw lotError;
    if (stateError) throw stateError;
    let lotRows = mirrorState ? [] : (legacyLotRows as Record<string, unknown>[]) ?? [];
    if (mirrorState && stockRows?.length) {
      const stock = stockRows as { odoo_lot_id: number; effective_quantity: number }[];
      const { data: masterRows, error: masterError } = await s.from("odoo_lots")
        .select("odoo_id,name,product_name,expiration_date").in("odoo_id", stock.map((row) => row.odoo_lot_id));
      if (masterError) throw masterError;
      const masters = new Map(((masterRows as Record<string, unknown>[]) ?? []).map((row) => [row.odoo_id as number, row]));
      lotRows = stock.flatMap((row) => masters.has(row.odoo_lot_id) ? [{ ...masters.get(row.odoo_lot_id)!, qty: row.effective_quantity }] : []);
    }
    lots = lotRows.map((lot) => ({
      odoo_id: lot.odoo_id as number,
      name: lot.name as string,
      product_name: (lot.product_name as string) ?? "Unknown product",
      available: Math.max(0, Number(lot.qty ?? 0)),
      expiration_date: (lot.expiration_date as string) ?? null,
    })).filter((lot) => lot.available > 0)
      .sort((a, b) => (a.expiration_date ?? "9999").localeCompare(b.expiration_date ?? "9999") || a.name.localeCompare(b.name));
  }

  const warehouse = machine.odoo_warehouses as { name?: string } | null;
  return {
    id: machine.id as string,
    name: (machine.display_name as string) || (machine.name as string),
    imei: (machine.device_imei as string) ?? null,
    warehouseId,
    warehouseName: warehouse?.name ?? null,
    lastFullClean: (machine.last_full_clean_date as string) ?? null,
    lots,
  };
}
