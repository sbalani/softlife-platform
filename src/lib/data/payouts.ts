import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type PayoutSettlement = {
  id: string;
  tenant_id: string;
  period_month: string;
  status: "pending" | "paid";
  calculated_total_cents: number;
  paid_total_cents: number | null;
  paid_at: string | null;
  paid_by: string | null;
  payment_reference: string | null;
  agreement_version: string | null;
};

export async function getPayoutSettlements(periodMonth: string, tenantIds: string[]): Promise<PayoutSettlement[]> {
  if (!isSupabaseConfigured() || tenantIds.length === 0) return [];
  const { data, error } = await (await createServiceClient())
    .from("franchisee_payout_settlements")
    .select("id,tenant_id,period_month,status,calculated_total_cents,paid_total_cents,paid_at,paid_by,payment_reference,agreement_version")
    .eq("period_month", `${periodMonth}-01`)
    .in("tenant_id", tenantIds);
  if (error) throw error;
  return (data as PayoutSettlement[]) ?? [];
}
