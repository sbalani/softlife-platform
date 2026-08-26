import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ProductionAdminData = {
  available: boolean;
  products: { id: string; name: string; consumption_type: string | null; default_portion_size: number | null; default_portion_uom: string | null; odoo_id: number | null }[];
  defaults: { consumption_type: string; quantity: number; uom: string }[];
  settings: { cup_product_id: string | null; currency: string } | null;
  warehouses: { odoo_id: number; name: string; sales_customer_odoo_id: number | null }[];
  pending: { id: string; order_id: string; line_index: number; raw_name: string | null; problem_code: string | null; order_code: string | null; order_time: string | null }[];
  runs: { id: string; idempotency_key: string; status: string; period_from: string; period_to: string; payload_sha256: string | null; blocked_count: number; created_at: string }[];
};

const empty: ProductionAdminData = { available: false, products: [], defaults: [], settings: null, warehouses: [], pending: [], runs: [] };

export async function getProductionAdminData(): Promise<ProductionAdminData> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return empty;
  try {
    const s = await createServiceClient();
    const [products, defaults, settings, warehouses, pending, runs] = await Promise.all([
      s.from("products").select("id,name,consumption_type,default_portion_size,default_portion_uom,odoo_id").order("name"),
      s.from("production_consumption_defaults").select("consumption_type,quantity,uom").order("consumption_type"),
      s.from("production_settings").select("cup_product_id,currency").eq("singleton", true).maybeSingle(),
      s.from("odoo_warehouses").select("odoo_id,name,sales_customer_odoo_id").order("name"),
      s.from("order_product_resolutions").select("id,order_id,line_index,raw_name,problem_code,huaxin_orders(order_code,order_time)").eq("resolution_status", "pending").order("created_at").limit(100),
      s.from("manufacturing_period_exports").select("id,idempotency_key,status,period_from,period_to,payload_sha256,blocked_reasons,created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    for (const result of [products, defaults, settings, warehouses, pending, runs]) if (result.error) throw result.error;
    return {
      available: true,
      products: (products.data ?? []).map((row) => ({ ...row, default_portion_size: row.default_portion_size == null ? null : Number(row.default_portion_size) })),
      defaults: (defaults.data ?? []).map((row) => ({ ...row, quantity: Number(row.quantity) })),
      settings: settings.data,
      warehouses: warehouses.data ?? [],
      pending: (pending.data as unknown as Record<string, unknown>[] ?? []).map((row) => {
        const order = Array.isArray(row.huaxin_orders) ? row.huaxin_orders[0] : row.huaxin_orders as Record<string, unknown> | null;
        return { id: String(row.id), order_id: String(row.order_id), line_index: Number(row.line_index), raw_name: row.raw_name as string | null, problem_code: row.problem_code as string | null, order_code: order?.order_code as string | null, order_time: order?.order_time as string | null };
      }),
      runs: (runs.data as unknown as Record<string, unknown>[] ?? []).map((row) => ({
        id: String(row.id), idempotency_key: String(row.idempotency_key), status: String(row.status), period_from: String(row.period_from), period_to: String(row.period_to),
        payload_sha256: row.payload_sha256 as string | null, blocked_count: Array.isArray(row.blocked_reasons) ? row.blocked_reasons.length : 0, created_at: String(row.created_at),
      })),
    };
  } catch {
    return empty;
  }
}
