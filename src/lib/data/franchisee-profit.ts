import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Order } from "./orders";

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
  try {
    const service = await createServiceClient();
    let query = service
      .from("machine_franchisee_assignments")
      .select("id,machine_id,tenant_id,start_date,end_date,service_model,share_percent,tenants(name),machines(name,device_imei)")
      .order("start_date", { ascending: false });
    if (machineId) query = query.eq("machine_id", machineId);
    const { data, error } = await query;
    if (error) return [];
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
  } catch {
    return [];
  }
}

export async function getVatRates(): Promise<VatRate[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const service = await createServiceClient();
    const { data } = await service.from("vat_rates").select("id,rate_percent,effective_from").order("effective_from");
    return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
      id: row.id as string,
      rate_percent: Number(row.rate_percent),
      effective_from: row.effective_from as string,
    }));
  } catch {
    return [];
  }
}

export type PayoutRow = {
  assignmentId: string;
  tenantId: string;
  tenantName: string;
  machineId: string;
  machineName: string;
  deviceImei: string | null;
  period: string;
  sharePercent: number;
  gross: number;
  vat: number;
  net: number;
  payout: number;
  orders: number;
};

export async function calculateFranchiseePayouts(orders: Order[]): Promise<PayoutRow[]> {
  const [assignments, vatRates] = await Promise.all([getFranchiseeAssignments(), getVatRates()]);
  const rows = new Map<string, PayoutRow>();

  for (const order of orders) {
    if (order.order_state !== "COMPLETE" || order.is_admin_override || !order.device_imei) continue;
    const orderDate = order.order_time.slice(0, 10);
    const assignment = assignments
      .filter((a) => a.device_imei === order.device_imei && a.start_date <= orderDate && (!a.end_date || a.end_date >= orderDate))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    if (!assignment) continue;

    const vatRate = [...vatRates].reverse().find((rate) => rate.effective_from <= orderDate)?.rate_percent ?? 10;
    const gross = order.price;
    const net = gross / (1 + vatRate / 100);
    const vat = gross - net;
    const payout = net * (assignment.share_percent / 100);
    const key = assignment.id;
    const existing = rows.get(key) ?? {
      assignmentId: assignment.id,
      tenantId: assignment.tenant_id,
      tenantName: assignment.tenant_name,
      machineId: assignment.machine_id,
      machineName: assignment.machine_name,
      deviceImei: assignment.device_imei,
      period: `${assignment.start_date} → ${assignment.end_date ?? "Ongoing"}`,
      sharePercent: assignment.share_percent,
      gross: 0,
      vat: 0,
      net: 0,
      payout: 0,
      orders: 0,
    };
    existing.gross += gross;
    existing.vat += vat;
    existing.net += net;
    existing.payout += payout;
    existing.orders += 1;
    rows.set(key, existing);
  }

  return [...rows.values()].sort((a, b) => b.payout - a.payout);
}
