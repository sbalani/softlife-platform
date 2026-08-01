import type { SupabaseClient } from "@supabase/supabase-js";
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
    const [{ data: lotRows, error: lotError }, { data: pendingRefills, error: refillError }] = await Promise.all([
      s.from("odoo_lots").select("odoo_id,name,product_name,qty,expiration_date")
        .eq("odoo_warehouse_id", warehouseId).gt("qty", 0)
        .order("expiration_date", { ascending: true, nullsFirst: false }).order("name"),
      s.from("reposiciones").select("id").in("odoo_sync_status", ["pending", "failed"]),
    ]);
    if (lotError) throw lotError;
    if (refillError) throw refillError;
    const refillIds = ((pendingRefills as { id: string }[]) ?? []).map((row) => row.id);
    let usageRows: { odoo_lot_id: number; quantity: number }[] = [];
    if (refillIds.length) {
      const { data, error } = await s.from("lot_usages").select("odoo_lot_id,quantity").in("reposicion_id", refillIds).not("odoo_lot_id", "is", null);
      if (error) throw error;
      usageRows = (data as { odoo_lot_id: number; quantity: number }[]) ?? [];
    }
    const reserved = new Map<number, number>();
    for (const usage of usageRows) reserved.set(usage.odoo_lot_id, (reserved.get(usage.odoo_lot_id) ?? 0) + Number(usage.quantity ?? 0));
    lots = ((lotRows as Record<string, unknown>[]) ?? []).map((lot) => ({
      odoo_id: lot.odoo_id as number,
      name: lot.name as string,
      product_name: (lot.product_name as string) ?? "Unknown product",
      available: Math.max(0, Number(lot.qty ?? 0) - (reserved.get(lot.odoo_id as number) ?? 0)),
      expiration_date: (lot.expiration_date as string) ?? null,
    })).filter((lot) => lot.available > 0);
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

export async function recordMachineService(s: SupabaseClient, values: {
  visitUuid: string;
  machineId: string;
  operatorId: string;
  eventTime: string;
  cleaningMaterialUsed: boolean | null;
  waterBucketCount: number | null;
  refillLines: { odoo_lot_id: number; quantity_used: number }[];
}) {
  const { data, error } = await s.rpc("record_machine_service", {
    p_visit_uuid: values.visitUuid,
    p_machine_id: values.machineId,
    p_operator_id: values.operatorId,
    p_device_event_time: values.eventTime,
    p_cleaning_material_used: values.cleaningMaterialUsed,
    p_water_bucket_count: values.waterBucketCount,
    p_refill_lines: values.refillLines,
  });
  if (error) throw error;
  return data;
}
