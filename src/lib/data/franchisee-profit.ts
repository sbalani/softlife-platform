import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Order } from "./orders";
import { getOrders } from "./orders";
import { calculatePayoutRows, type PayoutRow } from "@/lib/payout-report";

export type FranchiseeAssignment = {
  id: string;
  machine_id: string;
  tenant_id: string;
  start_date: string;
  end_date: string | null;
  service_model: "customer_service" | "softlife_service" | "custom";
  share_percent: number;
  tenant_name: string;
  machine_name: string;
  device_imei: string | null;
};

export type VatRate = { id: string; rate_percent: number; effective_from: string };

export async function getFranchiseeAssignments(machineId?: string): Promise<FranchiseeAssignment[]> {
  if (!isSupabaseConfigured()) return [];
  const service = await createServiceClient();
  let query = service
    .from("machine_franchisee_assignments")
    .select("id,machine_id,tenant_id,start_date,end_date,service_model,share_percent,tenants(name),machines(name,device_imei)")
    .order("start_date", { ascending: false });
  if (machineId) query = query.eq("machine_id", machineId);
  const { data, error } = await query;
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((row) => {
    const tenant = row.tenants as { name?: string } | null;
    const machine = row.machines as { name?: string; device_imei?: string } | null;
    return {
      id: row.id as string,
      machine_id: row.machine_id as string,
      tenant_id: row.tenant_id as string,
      start_date: row.start_date as string,
      end_date: (row.end_date as string) ?? null,
      service_model: row.service_model as FranchiseeAssignment["service_model"],
      share_percent: Number(row.share_percent),
      tenant_name: tenant?.name ?? "Franchisee",
      machine_name: machine?.name ?? "Machine",
      device_imei: machine?.device_imei ?? null,
    };
  });
}

export async function getVatRates(): Promise<VatRate[]> {
  if (!isSupabaseConfigured()) return [];
  const service = await createServiceClient();
  const { data, error } = await service.from("vat_rates").select("id,rate_percent,effective_from").order("effective_from");
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    id: row.id as string,
    rate_percent: Number(row.rate_percent),
    effective_from: row.effective_from as string,
  }));
}

export type { PayoutRow } from "@/lib/payout-report";

export async function calculateFranchiseePayouts(orders: Order[], range?: { from: string; to: string }): Promise<PayoutRow[]> {
  const [assignments, vatRates] = await Promise.all([getFranchiseeAssignments(), getVatRates()]);
  return calculatePayoutRows(orders, assignments, vatRates, range);
}

export async function getTenantPayoutReport(tenantId: string, from: string, to: string): Promise<{ tenantName: string; rows: PayoutRow[] } | null> {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
  const service = await createServiceClient();
  const { data: tenant, error: tenantError } = await service.from("tenants").select("id,name,kind").eq("id", tenantId).eq("kind", "franchisee").maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) return null;

  const { data, error } = await service
    .from("machine_franchisee_assignments")
    .select("id,machine_id,tenant_id,start_date,end_date,service_model,share_percent,machines(name,device_imei)")
    .eq("tenant_id", tenantId)
    .lte("start_date", to)
    .or(`end_date.is.null,end_date.gte.${from}`)
    .order("start_date", { ascending: false });
  if (error) throw error;
  const assignments = ((data as Record<string, unknown>[]) ?? []).map((row): FranchiseeAssignment => {
    const machine = row.machines as { name?: string; device_imei?: string } | null;
    return {
      id: row.id as string,
      machine_id: row.machine_id as string,
      tenant_id: row.tenant_id as string,
      start_date: row.start_date as string,
      end_date: (row.end_date as string) ?? null,
      service_model: row.service_model as FranchiseeAssignment["service_model"],
      share_percent: Number(row.share_percent),
      tenant_name: String(tenant.name),
      machine_name: machine?.name ?? "Machine",
      device_imei: machine?.device_imei ?? null,
    };
  });
  const machineIds = [...new Set(assignments.map((assignment) => assignment.machine_id))];
  const [orderResult, vatRates] = await Promise.all([
    getOrders({ dateFrom: from, dateTo: to, timeZone: "Europe/Madrid", machineIds }, service),
    getVatRates(),
  ]);
  if (orderResult.readError) throw new Error(orderResult.readError);
  return { tenantName: String(tenant.name), rows: calculatePayoutRows(orderResult.orders, assignments, vatRates, { from, to }) };
}
