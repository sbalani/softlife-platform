import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "../supabase/server";
import type { CustomerFiscalDetails } from "../customer-invoice-requests.ts";

export type CustomerInvoiceRequestAdmin = {
  id: string;
  source_order_id: string;
  order_code: string;
  order_time: string;
  status: string;
  fiscal_details: CustomerFiscalDetails;
  fiscal_details_sha256: string;
  accepted_at: string;
  created_at: string;
};

export async function recordAcceptedCustomerInvoiceRequest(s: SupabaseClient, input: {
  orderCode: string;
  fiscalDetails: CustomerFiscalDetails;
  actorId: string;
}) {
  const { data, error } = await s.rpc("record_customer_invoice_request", {
    p_order_code: input.orderCode,
    p_fiscal_details: input.fiscalDetails,
    p_actor_id: input.actorId,
  });
  if (error) {
    if (error.code === "23505") throw new Error("This source order already has an accepted customer invoice request.");
    throw error;
  }
  return data as { request_id: string; source_order_id: string; fiscal_details_sha256: string; idempotent: boolean };
}

export async function getCustomerInvoiceRequestAdminData(): Promise<{ available: boolean; requests: CustomerInvoiceRequestAdmin[] }> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { available: false, requests: [] };
  try {
    const s = await createServiceClient();
    const { data, error } = await s.from("customer_invoice_requests")
      .select("id,source_order_id,status,fiscal_details,fiscal_details_sha256,accepted_at,created_at,huaxin_orders!inner(order_code,order_time)")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return { available: true, requests: ((data as unknown as Record<string, unknown>[]) ?? []).map((row) => {
      const order = (Array.isArray(row.huaxin_orders) ? row.huaxin_orders[0] : row.huaxin_orders) as Record<string, unknown>;
      return {
        id: String(row.id), source_order_id: String(row.source_order_id), order_code: String(order.order_code),
        order_time: String(order.order_time), status: String(row.status), fiscal_details: row.fiscal_details as CustomerFiscalDetails,
        fiscal_details_sha256: String(row.fiscal_details_sha256), accepted_at: String(row.accepted_at), created_at: String(row.created_at),
      };
    }) };
  } catch {
    return { available: false, requests: [] };
  }
}
