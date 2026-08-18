import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type LotUsage = {
  id: string;
  machine_name: string | null;
  device_imei: string | null;
  product_name: string | null;
  product_type: string;
  lot_name: string;
  position: string | null;
  quantity: number | null;
  device_event_time: string;
};

export type ProvenanceGap = {
  id: string;
  report_id: string;
  machine_name: string;
  occurred_at: string;
  quantity: number;
  unit: string;
  product_name: string | null;
  lot_code: string | null;
  reason: string | null;
  status: string;
  assigned_warehouse_id: number | null;
  warehouse_name: string | null;
  observed_odoo_lot_id: number | null;
  allocated_quantity: number;
  outstanding_quantity: number;
  operator_name: string | null;
  recorded_at: string;
  candidates: { lotId: number; lotCode: string; productName: string; stockUnit: string; available: number; match: string }[];
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function getLotUsages(filters: {
  dateFrom?: string;
  dateTo?: string;
  machine?: string;
  productType?: string;
  lotName?: string;
}, access?: { machineIds?: string[]; tenantId?: string }): Promise<LotUsage[]> {
  if (!isSupabaseConfigured() || (!access?.tenantId && access?.machineIds?.length === 0)) return [];
  const s = await createServiceClient();
  let q = s.from("lot_usages").select("*").order("device_event_time", { ascending: false }).limit(200);
  if (access?.tenantId) q = q.eq("tenant_id", access.tenantId);
  else if (access?.machineIds) q = q.in("machine_id", access.machineIds);
  if (filters.dateFrom) q = q.gte("device_event_time", filters.dateFrom);
  if (filters.dateTo) q = q.lte("device_event_time", filters.dateTo + "T23:59:59");
  if (filters.machine) q = q.or(`machine_name.ilike.%${filters.machine}%,device_imei.ilike.%${filters.machine}%`);
  if (filters.productType) q = q.eq("product_type", filters.productType);
  if (filters.lotName) q = q.ilike("lot_name", `%${filters.lotName}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data as LotUsage[]) ?? [];
}

export async function getMachineLotHistory(machineId: string, imei: string): Promise<LotUsage[]> {
  if (!isSupabaseConfigured()) return [];
  const s = await createServiceClient();
  const { data, error } = await s
    .from("lot_usages")
    .select("*")
    .or(`machine_id.eq.${machineId},device_imei.eq.${imei}`)
    .order("device_event_time", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as LotUsage[]) ?? [];
}

export async function getProvenanceGaps(filters: { machineIds?: string[]; tenantId?: string }): Promise<ProvenanceGap[]> {
  if (!isSupabaseConfigured() || (!filters.tenantId && filters.machineIds?.length === 0)) return [];
  const s = await createServiceClient();
  let reportsQuery = s.from("service_action_reports")
    .select("id,machine_id,operator_id,occurred_at,created_at,assigned_warehouse_id,machines(name,display_name),odoo_warehouses(name)")
    .eq("status", "confirmed").neq("provenance_status", "resolved")
    .order("occurred_at", { ascending: false }).limit(100);
  if (filters.tenantId) reportsQuery = reportsQuery.eq("tenant_id", filters.tenantId);
  else if (filters.machineIds) reportsQuery = reportsQuery.in("machine_id", filters.machineIds);
  const { data: reports, error: reportError } = await reportsQuery;
  if (reportError) throw reportError;
  const reportRows = (reports as Record<string, unknown>[]) ?? [];
  if (!reportRows.length) return [];
  const reportById = new Map(reportRows.map((report) => [report.id as string, report]));
  const operatorIds = [...new Set(reportRows.map((report) => report.operator_id as string))];
  const [{ data: lines, error: lineError }, { data: profiles, error: profileError }, { data: balances, error: balanceError }, { data: lots, error: lotError }] = await Promise.all([
    s.from("service_action_refill_lines")
      .select("id,report_id,quantity,unit,product_name,observed_lot_code,observed_odoo_lot_id,unresolved_reason,provenance_status,refill_stock_allocations(quantity,status)")
      .in("report_id", [...reportById.keys()]).neq("provenance_status", "resolved").order("created_at", { ascending: false }),
    s.from("profiles").select("id,full_name,email").in("id", operatorIds),
    s.from("warehouse_lot_effective_balances").select("odoo_warehouse_id,odoo_lot_id,effective_quantity").gt("effective_quantity", 0),
    s.from("odoo_lots").select("odoo_id,name,product_name,odoo_products(uom)"),
  ]);
  if (lineError) throw lineError;
  if (profileError) throw profileError;
  if (balanceError) throw balanceError;
  if (lotError) throw lotError;
  const operatorById = new Map(((profiles as { id: string; full_name: string | null; email: string | null }[]) ?? []).map((profile) => [profile.id, profile.full_name ?? profile.email]));
  const lotById = new Map(((lots as unknown as { odoo_id: number; name: string; product_name: string | null; odoo_products: { uom: string | null } | { uom: string | null }[] | null }[]) ?? []).map((lot) => [lot.odoo_id, lot]));
  return ((lines as Record<string, unknown>[]) ?? []).map((line) => {
    const report = reportById.get(line.report_id as string)!;
    const machine = report.machines as { name: string; display_name: string | null } | null;
    const warehouse = report.odoo_warehouses as { name: string } | null;
    const allocations = (line.refill_stock_allocations as { quantity: number; status: string }[]) ?? [];
    const allocated = allocations.filter((allocation) => allocation.status === "confirmed").reduce((sum, allocation) => sum + Number(allocation.quantity), 0);
    const warehouseId = report.assigned_warehouse_id as number | null;
    const observedId = line.observed_odoo_lot_id as number | null;
    const observedCode = line.observed_lot_code as string | null;
    const candidates = ((balances as { odoo_warehouse_id: number; odoo_lot_id: number; effective_quantity: number }[]) ?? []).flatMap((balance) => {
      if (warehouseId === null || balance.odoo_warehouse_id !== warehouseId) return [];
      const lot = lotById.get(balance.odoo_lot_id);
      if (!lot) return [];
      const exactId = observedId !== null && lot.odoo_id === observedId;
      const exactCode = observedCode !== null && lot.name.toLocaleLowerCase() === observedCode.toLocaleLowerCase();
      if (!exactId && !exactCode) return [];
      return [{ lotId: lot.odoo_id, lotCode: lot.name, productName: lot.product_name ?? "Unknown product", stockUnit: relatedOne(lot.odoo_products)?.uom ?? "unit", available: Number(balance.effective_quantity), match: exactId ? "observed lot" : "lot code" }];
    });
    return {
      id: line.id as string,
      report_id: line.report_id as string,
      machine_name: machine?.display_name || machine?.name || "Unknown machine",
      occurred_at: report.occurred_at as string,
      quantity: Number(line.quantity),
      unit: line.unit as string,
      product_name: line.product_name as string | null,
      lot_code: line.observed_lot_code as string | null,
      reason: line.unresolved_reason as string | null,
      status: line.provenance_status as string,
      assigned_warehouse_id: warehouseId,
      warehouse_name: warehouse?.name ?? null,
      observed_odoo_lot_id: observedId,
      allocated_quantity: allocated,
      outstanding_quantity: Math.max(0, Number(line.quantity) - allocated),
      operator_name: operatorById.get(report.operator_id as string) ?? null,
      recorded_at: report.created_at as string,
      candidates,
    };
  });
}
