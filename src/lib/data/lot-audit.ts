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
};

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
    .select("id,machine_id,occurred_at,machines(name,display_name)")
    .eq("status", "confirmed").neq("provenance_status", "resolved")
    .order("occurred_at", { ascending: false }).limit(100);
  if (filters.tenantId) reportsQuery = reportsQuery.eq("tenant_id", filters.tenantId);
  else if (filters.machineIds) reportsQuery = reportsQuery.in("machine_id", filters.machineIds);
  const { data: reports, error: reportError } = await reportsQuery;
  if (reportError) throw reportError;
  const reportRows = (reports as Record<string, unknown>[]) ?? [];
  if (!reportRows.length) return [];
  const reportById = new Map(reportRows.map((report) => [report.id as string, report]));
  const { data: lines, error: lineError } = await s.from("service_action_refill_lines")
    .select("id,report_id,quantity,unit,product_name,observed_lot_code,unresolved_reason,provenance_status")
    .in("report_id", [...reportById.keys()]).neq("provenance_status", "resolved").order("created_at", { ascending: false });
  if (lineError) throw lineError;
  return ((lines as Record<string, unknown>[]) ?? []).map((line) => {
    const report = reportById.get(line.report_id as string)!;
    const machine = report.machines as { name: string; display_name: string | null } | null;
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
    };
  });
}
