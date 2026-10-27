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
  contract_acceptance_id: string | null;
  source_snapshot: unknown;
};

export type PayoutSelfBill = {
  id: string;
  settlement_id: string;
  tenant_id: string;
  status: "draft_pending" | "draft" | "post_pending" | "pdf_pending" | "completed" | "failed";
  draft_only: boolean;
  gross_cents: number;
  tax_base_cents: number;
  iva_cents: number;
  contract_acceptance_id: string | null;
  contract_version: string;
  draft_request_id: string | null;
  post_request_id: string | null;
  pdf_request_id: string | null;
  odoo_move_id: number | null;
  odoo_name: string | null;
  error: string | null;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  pdf_size_bytes: number | null;
};

export async function getPayoutSettlements(periodMonth: string, tenantIds: string[]): Promise<PayoutSettlement[]> {
  if (!isSupabaseConfigured() || tenantIds.length === 0) return [];
  const { data, error } = await (await createServiceClient())
    .from("franchisee_payout_settlements")
    .select("id,tenant_id,period_month,status,calculated_total_cents,paid_total_cents,paid_at,paid_by,payment_reference,agreement_version,contract_acceptance_id,source_snapshot")
    .eq("period_month", `${periodMonth}-01`)
    .in("tenant_id", tenantIds);
  if (error) throw error;
  return (data as PayoutSettlement[]) ?? [];
}

export async function getPayoutSelfBills(settlementIds: string[]): Promise<PayoutSelfBill[]> {
  if (!isSupabaseConfigured() || settlementIds.length === 0) return [];
  const { data, error } = await (await createServiceClient())
    .from("payout_self_bills")
    .select("id,settlement_id,tenant_id,status,draft_only,gross_cents,tax_base_cents,iva_cents,contract_acceptance_id,contract_version,draft_request_id,post_request_id,pdf_request_id,odoo_move_id,odoo_name,error,pdf_storage_path,pdf_sha256,pdf_size_bytes")
    .in("settlement_id", settlementIds);
  if (error) throw error;
  return (data as PayoutSelfBill[]) ?? [];
}
