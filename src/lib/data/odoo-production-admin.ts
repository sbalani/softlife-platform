import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ProductionAdminData = {
  available: boolean;
  products: { id: string; name: string; consumption_type: string | null; default_portion_size: number | null; default_portion_uom: string | null; odoo_id: number | null; override_quantity: number | null; override_uom: string | null }[];
  odooProducts: { odoo_id: number; name: string; sku: string | null }[];
  recipes: { id: string; name: string }[];
  defaults: { consumption_type: string; quantity: number; uom: string }[];
  settings: { cup_odoo_product_id: number | null; currency: string } | null;
  warehouses: { odoo_id: number; name: string; sales_customer_odoo_id: number | null }[];
  pending: { id: string; order_id: string; line_index: number; raw_name: string | null; normalized_name: string | null; raw_position: string | null; menu_kind: string | null; problem_code: string | null; order_code: string | null; order_time: string | null; machine_name: string | null }[];
  runs: { id: string; idempotency_key: string; initiated_by: string; status: string; period_from: string; period_to: string; time_zone: string; document_date: string; payload_sha256: string | null; payload: Record<string, unknown> | null; blocked_items: Record<string, unknown>[]; odoo_result: Record<string, unknown> | null; order_count: number; created_at: string; confirmed_at: string | null; updated_at: string }[];
};

const empty: ProductionAdminData = { available: false, products: [], odooProducts: [], recipes: [], defaults: [], settings: null, warehouses: [], pending: [], runs: [] };

function objectRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

export async function getProductionAdminData(): Promise<ProductionAdminData> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return empty;
  try {
    const s = await createServiceClient();
    const [products, productOverrides, odooProducts, recipes, defaults, settings, warehouses, pending, runs] = await Promise.all([
      s.from("products").select("id,name,consumption_type,default_portion_size,default_portion_uom,odoo_id").order("name"),
      s.from("production_product_consumption_overrides").select("product_id,quantity,uom"),
      s.from("odoo_products").select("odoo_id,name,sku").order("name"),
      s.from("recipes").select("id,name").eq("active", true).order("name"),
      s.from("production_consumption_defaults").select("consumption_type,quantity,uom").order("consumption_type"),
      s.from("production_settings").select("cup_odoo_product_id,currency").eq("singleton", true).maybeSingle(),
      s.from("odoo_warehouses").select("odoo_id,name,sales_customer_odoo_id").order("name"),
      s.from("order_product_resolutions").select("id,order_id,line_index,raw_name,normalized_name,raw_position,menu_kind,problem_code,huaxin_orders(order_code,order_time,machines(name))").eq("resolution_status", "pending").order("created_at").limit(100),
      s.from("manufacturing_period_exports").select("id,idempotency_key,initiated_by,status,period_from,period_to,time_zone,document_date,payload_sha256,payload,blocked_reasons,odoo_result,created_at,confirmed_at,updated_at,manufacturing_period_export_orders(count)").is("manufacturing_period_export_orders.released_at", null).order("created_at", { ascending: false }).limit(50),
    ]);
    for (const result of [products, productOverrides, odooProducts, recipes, defaults, settings, warehouses, pending, runs]) if (result.error) throw result.error;
    const overrides = new Map((productOverrides.data ?? []).map((row) => [row.product_id, row]));
    const runRows = (runs.data as unknown as Record<string, unknown>[]) ?? [];
    const blockedOrderIds = [...new Set(runRows.flatMap((run) => objectRecords(run.blocked_reasons)
      .filter((item) => item.problem_code === "already_in_production_run")
      .map((item) => String(item.order_id ?? ""))
      .filter(Boolean)))];
    const blockingRuns = new Map<string, { id: string; idempotency_key: string; status: string }>();
    for (let offset = 0; offset < blockedOrderIds.length; offset += 200) {
      const ownerResult = await s.from("manufacturing_period_export_orders")
        .select("order_id,manufacturing_period_exports!inner(id,idempotency_key,status)")
        .in("order_id", blockedOrderIds.slice(offset, offset + 200)).is("released_at", null);
      if (ownerResult.error) throw ownerResult.error;
      for (const row of (ownerResult.data as unknown as Record<string, unknown>[]) ?? []) {
        const owner = Array.isArray(row.manufacturing_period_exports) ? row.manufacturing_period_exports[0] : row.manufacturing_period_exports;
        if (owner && typeof owner === "object") blockingRuns.set(String(row.order_id), {
          id: String((owner as Record<string, unknown>).id),
          idempotency_key: String((owner as Record<string, unknown>).idempotency_key),
          status: String((owner as Record<string, unknown>).status),
        });
      }
    }
    return {
      available: true,
      products: (products.data ?? []).map((row) => ({
        ...row,
        default_portion_size: row.default_portion_size == null ? null : Number(row.default_portion_size),
        override_quantity: overrides.get(row.id)?.quantity == null ? null : Number(overrides.get(row.id)?.quantity),
        override_uom: overrides.get(row.id)?.uom ?? null,
      })),
      odooProducts: odooProducts.data ?? [],
      recipes: recipes.data ?? [],
      defaults: (defaults.data ?? []).map((row) => ({ ...row, quantity: Number(row.quantity) })),
      settings: settings.data,
      warehouses: warehouses.data ?? [],
      pending: (pending.data as unknown as Record<string, unknown>[] ?? []).map((row) => {
        const order = Array.isArray(row.huaxin_orders) ? row.huaxin_orders[0] : row.huaxin_orders as Record<string, unknown> | null;
        const machine = order && (Array.isArray(order.machines) ? order.machines[0] : order.machines) as Record<string, unknown> | null;
        return {
          id: String(row.id), order_id: String(row.order_id), line_index: Number(row.line_index), raw_name: row.raw_name as string | null,
          normalized_name: row.normalized_name as string | null, raw_position: row.raw_position as string | null, menu_kind: row.menu_kind as string | null,
          problem_code: row.problem_code as string | null, order_code: order?.order_code as string | null, order_time: order?.order_time as string | null,
          machine_name: machine?.name as string | null,
        };
      }),
      runs: runRows.map((row) => {
        const membershipCount = Array.isArray(row.manufacturing_period_export_orders) ? row.manufacturing_period_export_orders[0] as { count?: number } | undefined : undefined;
        return {
          id: String(row.id), idempotency_key: String(row.idempotency_key), initiated_by: String(row.initiated_by), status: String(row.status), period_from: String(row.period_from), period_to: String(row.period_to),
          time_zone: String(row.time_zone), document_date: String(row.document_date), payload_sha256: row.payload_sha256 as string | null,
          payload: row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : null,
          blocked_items: objectRecords(row.blocked_reasons).map((item) => {
            const owner = blockingRuns.get(String(item.order_id ?? ""));
            return owner ? { ...item, blocking_export_id: owner.id, blocking_idempotency_key: owner.idempotency_key, blocking_status: owner.status } : item;
          }),
          odoo_result: row.odoo_result && typeof row.odoo_result === "object" ? row.odoo_result as Record<string, unknown> : null,
          order_count: Number(membershipCount?.count ?? 0), created_at: String(row.created_at), confirmed_at: row.confirmed_at as string | null, updated_at: String(row.updated_at),
        };
      }),
    };
  } catch {
    return empty;
  }
}
