import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ActionReportHistoryItem = {
  id: string;
  actionKind: string;
  occurredAt: string;
  status: string;
  provenanceStatus: string;
  machineName: string;
  notes: string | null;
  refillLines: { quantity: number; unit: string; lotCode: string | null; productName: string | null; provenanceStatus: string }[];
};

export type ActionReportLotOption = {
  odooId: number;
  name: string;
  productName: string;
  available: number;
  warehouseId: number;
};

export type ActionReportDraft = {
  id: string;
  clientUuid: string;
  machineId: string;
  occurredAt: string;
  actionKind: "cleaning" | "refill" | "both" | "other";
  notes: string;
  cleaningMaterialUsed: boolean | null;
  waterBucketCount: number | null;
  lines: { odooLotId: number | null; lotCode: string; productName: string; quantity: number; unit: string }[];
};

export async function getActionReportLots(warehouseIds: number[]): Promise<ActionReportLotOption[]> {
  if (!isSupabaseConfigured() || warehouseIds.length === 0) return [];
  const s = await createServiceClient();
  const { data: stock, error: stockError } = await s.from("warehouse_lot_effective_balances")
    .select("odoo_lot_id,odoo_warehouse_id,effective_quantity").in("odoo_warehouse_id", warehouseIds).gt("effective_quantity", 0);
  if (stockError) throw stockError;
  const rows = (stock as { odoo_lot_id: number; odoo_warehouse_id: number; effective_quantity: number }[]) ?? [];
  if (!rows.length) return [];
  const { data: lots, error: lotError } = await s.from("odoo_lots")
    .select("odoo_id,name,product_name,expiration_date").in("odoo_id", [...new Set(rows.map((row) => row.odoo_lot_id))]);
  if (lotError) throw lotError;
  const lotById = new Map(((lots as { odoo_id: number; name: string; product_name: string | null; expiration_date: string | null }[]) ?? []).map((lot) => [lot.odoo_id, lot]));
  return rows.flatMap((row) => {
    const lot = lotById.get(row.odoo_lot_id);
    const available = Math.max(0, Number(row.effective_quantity));
    return lot && available > 0 ? [{ odooId: lot.odoo_id, name: lot.name, productName: lot.product_name ?? "Unknown product", available, warehouseId: row.odoo_warehouse_id, expiration: lot.expiration_date }] : [];
  }).sort((a, b) => (a.expiration ?? "9999").localeCompare(b.expiration ?? "9999") || a.name.localeCompare(b.name))
    .map((lot) => ({ odooId: lot.odooId, name: lot.name, productName: lot.productName, available: lot.available, warehouseId: lot.warehouseId }));
}

export async function getActionReportHistory(filters: { machineIds?: string[]; tenantId?: string; actorId?: string }): Promise<ActionReportHistoryItem[]> {
  if (!isSupabaseConfigured() || (!filters.tenantId && filters.machineIds?.length === 0)) return [];
  const s = await createServiceClient();
  let query = s.from("service_action_reports")
    .select("id,operator_id,action_kind,occurred_at,status,provenance_status,notes,machines(name,display_name),service_action_refill_lines(quantity,unit,observed_lot_code,product_name,provenance_status)")
    .order("occurred_at", { ascending: false }).limit(50);
  if (filters.tenantId) query = query.eq("tenant_id", filters.tenantId);
  else if (filters.machineIds) query = query.in("machine_id", filters.machineIds);
  const { data, error } = await query;
  if (error) throw error;
  const canonical = ((data as Record<string, unknown>[]) ?? []).filter((row) => row.status !== "draft" || !filters.actorId || row.operator_id === filters.actorId).map((row) => {
    const machine = row.machines as { name: string; display_name: string | null } | null;
    const lines = (row.service_action_refill_lines as Record<string, unknown>[]) ?? [];
    return {
      id: row.id as string,
      actionKind: row.action_kind as string,
      occurredAt: row.occurred_at as string,
      status: row.status as string,
      provenanceStatus: row.provenance_status as string,
      machineName: machine?.display_name || machine?.name || "Unknown machine",
      notes: row.notes as string | null,
      refillLines: lines.map((line) => ({
        quantity: Number(line.quantity),
        unit: line.unit as string,
        lotCode: line.observed_lot_code as string | null,
        productName: line.product_name as string | null,
        provenanceStatus: line.provenance_status as string,
      })),
    };
  });

  if (filters.machineIds?.length === 0) return canonical;
  let refillQuery = s.from("reposiciones")
    .select("id,device_event_time,status,payload_json,machines(name,display_name)")
    .is("service_action_report_id", null).order("device_event_time", { ascending: false }).limit(50);
  let cleaningQuery = s.from("clean_logs")
    .select("id,device_event_time,machines(name,display_name)")
    .is("service_action_report_id", null).order("device_event_time", { ascending: false }).limit(50);
  if (filters.tenantId) {
    refillQuery = refillQuery.eq("tenant_id", filters.tenantId);
    cleaningQuery = cleaningQuery.eq("tenant_id", filters.tenantId);
  } else if (filters.machineIds) {
    refillQuery = refillQuery.in("machine_id", filters.machineIds);
    cleaningQuery = cleaningQuery.in("machine_id", filters.machineIds);
  }
  const [{ data: refills, error: refillError }, { data: cleanings, error: cleaningError }] = await Promise.all([refillQuery, cleaningQuery]);
  if (refillError) throw refillError;
  if (cleaningError) throw cleaningError;
  const legacyRefills: ActionReportHistoryItem[] = ((refills as Record<string, unknown>[]) ?? []).map((row) => {
    const machine = row.machines as { name: string; display_name: string | null } | null;
    const payload = (row.payload_json as { lines?: Record<string, unknown>[] } | null) ?? {};
    return {
      id: row.id as string,
      actionKind: "refill",
      occurredAt: row.device_event_time as string,
      status: row.status as string,
      provenanceStatus: "legacy",
      machineName: machine?.display_name || machine?.name || "Unknown machine",
      notes: null,
      refillLines: (payload.lines ?? []).map((line) => ({
        quantity: Number(line.quantity_used ?? line.qty ?? 0),
        unit: String(line.unit ?? "unit"),
        lotCode: String(line.lot_name ?? "") || null,
        productName: String(line.product_name ?? "") || null,
        provenanceStatus: "legacy",
      })),
    };
  });
  const legacyCleanings: ActionReportHistoryItem[] = ((cleanings as Record<string, unknown>[]) ?? []).map((row) => {
    const machine = row.machines as { name: string; display_name: string | null } | null;
    return {
      id: row.id as string,
      actionKind: "cleaning",
      occurredAt: row.device_event_time as string,
      status: "confirmed",
      provenanceStatus: "legacy",
      machineName: machine?.display_name || machine?.name || "Unknown machine",
      notes: null,
      refillLines: [],
    };
  });
  return [...canonical, ...legacyRefills, ...legacyCleanings]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 50);
}

export async function getActionReportDraft(id: string, tenantId?: string, actorId?: string): Promise<ActionReportDraft | null> {
  if (!isSupabaseConfigured() || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = await createServiceClient();
  let query = s.from("service_action_reports")
    .select("id,client_uuid,machine_id,occurred_at,action_kind,notes,cleaning_material_used,water_bucket_count,service_action_refill_lines(odoo_lot_id:observed_odoo_lot_id,lot_code:observed_lot_code,product_name,quantity,unit,line_number)")
    .eq("id", id).eq("status", "draft");
  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (actorId) query = query.eq("operator_id", actorId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const lines = ((row.service_action_refill_lines as Record<string, unknown>[]) ?? [])
    .sort((a, b) => Number(a.line_number) - Number(b.line_number));
  return {
    id: row.id as string,
    clientUuid: row.client_uuid as string,
    machineId: row.machine_id as string,
    occurredAt: row.occurred_at as string,
    actionKind: row.action_kind as ActionReportDraft["actionKind"],
    notes: (row.notes as string | null) ?? "",
    cleaningMaterialUsed: row.cleaning_material_used as boolean | null,
    waterBucketCount: row.water_bucket_count as number | null,
    lines: lines.map((line) => ({
      odooLotId: line.odoo_lot_id as number | null,
      lotCode: (line.lot_code as string | null) ?? "",
      productName: (line.product_name as string | null) ?? "",
      quantity: Number(line.quantity),
      unit: line.unit as string,
    })),
  };
}
