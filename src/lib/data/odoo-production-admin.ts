import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeObservedName } from "@/lib/odoo-sync-contract";
import { rankRecipeMatches, type RecipeMatchCandidate } from "@/lib/recipe-matching";

export type ProductionAdminData = {
  available: boolean;
  products: { id: string; name: string; consumption_type: string | null; default_portion_size: number | null; default_portion_uom: string | null; odoo_id: number | null; override_quantity: number | null; override_uom: string | null; effective_quantity: number | null; effective_uom: string | null; effective_source: string; odoo_stock_uom: string | null; odoo_qty_available: number | null; package_content_quantity: number | null; package_content_uom: string | null }[];
  odooProducts: { odoo_id: number; name: string; sku: string | null; uom: string | null; package_content_quantity: number | null; package_content_uom: string | null }[];
  recipes: { id: string; name: string }[];
  defaults: { consumption_type: string; quantity: number; uom: string }[];
  settings: { cup_odoo_product_id: number | null; currency: string; replenishment_source_odoo_warehouse_id: number | null } | null;
  warehouses: { odoo_id: number; name: string; sales_customer_odoo_id: number | null; stock_location_id: number | null }[];
  stockSnapshot: {
    checkedAt: string;
    warehouseProductObservedAt: string | null; lotStockObservedAt: string | null;
    warehouseProductRows: number; lotStockRows: number; products: number; trackedProducts: number; warehouses: number;
    warehouseRows: { odoo_warehouse_id: number; name: string; stock_location_id: number | null; product_rows: number; lot_rows: number }[];
    latestRequest: { id: string; status: string; requested_at: string; claimed_at: string | null; completed_at: string | null; attempts: number; result: Record<string, unknown> | null; error: string | null } | null;
  } | null;
  pending: { id: string; order_id: string; line_index: number; raw_name: string | null; normalized_name: string | null; raw_position: string | null; menu_kind: string | null; problem_code: string | null; order_code: string | null; order_time: string | null; machine_name: string | null }[];
  runs: { id: string; idempotency_key: string; initiated_by: string; status: string; period_from: string; period_to: string; time_zone: string; document_date: string; payload_sha256: string | null; payload: Record<string, unknown> | null; blocked_items: Record<string, unknown>[]; replenishment_result: Record<string, unknown> | null; odoo_result: Record<string, unknown> | null; order_count: number; created_at: string; replenishment_confirmed_at: string | null; confirmed_at: string | null; updated_at: string }[];
};

const empty: ProductionAdminData = { available: false, products: [], odooProducts: [], recipes: [], defaults: [], settings: null, warehouses: [], stockSnapshot: null, pending: [], runs: [] };

function objectRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

export async function getProductionAdminData(): Promise<ProductionAdminData> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return empty;
  try {
    const s = await createServiceClient();
    const [products, odooProducts, recipes, defaults, settings, warehouses, snapshot, latestRequest, pending, runs] = await Promise.all([
      s.from("products").select("id,name,consumption_type,default_portion_size,default_portion_uom,odoo_id,product_aliases(alias,normalized_alias),odoo_products(uom,qty_available,package_content_quantity,package_content_uom),production_product_consumption_overrides(quantity,uom)").order("name"),
      s.from("odoo_products").select("odoo_id,name,sku,uom,package_content_quantity,package_content_uom").order("name"),
      s.from("recipes").select("id,name,recipe_components(product_id)").eq("active", true).order("name"),
      s.from("production_consumption_defaults").select("consumption_type,quantity,uom").order("consumption_type"),
      s.from("production_settings").select("cup_odoo_product_id,currency,replenishment_source_odoo_warehouse_id").eq("singleton", true).maybeSingle(),
      s.from("odoo_warehouses").select("odoo_id,name,sales_customer_odoo_id,stock_location_id").order("name"),
      s.rpc("get_odoo_stock_snapshot_diagnostics"),
      s.from("odoo_sync_requests").select("id,status,requested_at,claimed_at,completed_at,attempts,result,error").order("requested_at", { ascending: false }).limit(1).maybeSingle(),
      s.from("order_product_resolutions").select("id,order_id,line_index,raw_name,normalized_name,raw_position,menu_kind,problem_code,huaxin_orders(order_code,order_time,machines(name))").eq("resolution_status", "pending").order("created_at").limit(100),
      s.from("manufacturing_period_exports").select("id,idempotency_key,initiated_by,status,period_from,period_to,time_zone,document_date,payload_sha256,payload,blocked_reasons,replenishment_result,odoo_result,created_at,replenishment_confirmed_at,confirmed_at,updated_at,manufacturing_period_export_orders(count)").is("manufacturing_period_export_orders.released_at", null).order("created_at", { ascending: false }).limit(50),
    ]);
    for (const result of [products, odooProducts, recipes, defaults, settings, warehouses, snapshot, latestRequest, pending, runs]) if (result.error) throw result.error;
    const defaultsByType = new Map((defaults.data ?? []).map((row) => [row.consumption_type, row]));
    const runRows = (runs.data as unknown as Record<string, unknown>[]) ?? [];
    const productionProducts = (products.data as unknown as Record<string, unknown>[] ?? []).map((row) => {
      const rawOverride = row.production_product_consumption_overrides;
      const override = (Array.isArray(rawOverride) ? rawOverride[0] : rawOverride) as Record<string, unknown> | null;
      const defaultPortion = row.consumption_type ? defaultsByType.get(String(row.consumption_type)) : undefined;
      const odooProduct = Array.isArray(row.odoo_products) ? row.odoo_products[0] : row.odoo_products as Record<string, unknown> | null;
      const effective = override ? { quantity: Number(override.quantity), uom: override.uom, source: "Ingredient override" }
          : row.default_portion_size != null && row.default_portion_uom ? { quantity: Number(row.default_portion_size), uom: String(row.default_portion_uom), source: "Ingredient override" }
          : defaultPortion ? { quantity: Number(defaultPortion.quantity), uom: defaultPortion.uom, source: "Global type default" } : null;
      return {
        id: String(row.id), name: String(row.name), consumption_type: row.consumption_type as string | null,
        default_portion_size: row.default_portion_size == null ? null : Number(row.default_portion_size), default_portion_uom: row.default_portion_uom as string | null,
        odoo_id: row.odoo_id == null ? null : Number(row.odoo_id),
        override_quantity: override?.quantity == null ? row.default_portion_size == null ? null : Number(row.default_portion_size) : Number(override.quantity),
        override_uom: override?.uom == null ? row.default_portion_uom as string | null : String(override.uom),
        effective_quantity: effective?.quantity ?? null, effective_uom: effective?.uom ?? null, effective_source: effective?.source ?? "Missing",
        odoo_stock_uom: odooProduct?.uom == null ? null : String(odooProduct.uom),
        odoo_qty_available: odooProduct?.qty_available == null ? null : Number(odooProduct.qty_available),
        package_content_quantity: odooProduct?.package_content_quantity == null ? null : Number(odooProduct.package_content_quantity),
        package_content_uom: odooProduct?.package_content_uom == null ? null : String(odooProduct.package_content_uom),
      };
    });
    const productionProductsById = new Map(productionProducts.map((product) => [product.id, product]));
    const productsByName = new Map<string, string[]>();
    for (const product of (products.data as unknown as Record<string, unknown>[]) ?? []) {
      const aliases = objectRecords(product.product_aliases);
      const keys = [normalizeObservedName(String(product.name)), ...aliases.map((alias) => String(alias.normalized_alias || normalizeObservedName(String(alias.alias))))];
      for (const key of keys) {
        const ids = productsByName.get(key) ?? [];
        if (!ids.includes(String(product.id))) productsByName.set(key, [...ids, String(product.id)]);
      }
    }
    const recipeCandidates: RecipeMatchCandidate[] = ((recipes.data as unknown as Record<string, unknown>[]) ?? []).map((recipe) => ({
      id: String(recipe.id), name: String(recipe.name),
      componentIds: objectRecords(recipe.recipe_components).map((component) => String(component.product_id)),
    }));
    const blockedOrderIds = [...new Set(runRows.flatMap((run) => objectRecords(run.blocked_reasons)
      .filter((item) => item.problem_code === "already_in_production_run")
      .map((item) => String(item.order_id ?? ""))
      .filter(Boolean)))];
    const missingRecipeOrderIds = [...new Set(runRows.flatMap((run) => objectRecords(run.blocked_reasons)
      .filter((item) => item.problem_code === "missing_recipe")
      .map((item) => String(item.order_id ?? ""))
      .filter(Boolean)))];
    const blockingRuns = new Map<string, { id: string; idempotency_key: string; status: string; period_from: string; period_to: string; time_zone: string }>();
    for (let offset = 0; offset < blockedOrderIds.length; offset += 200) {
      const ownerResult = await s.from("manufacturing_period_export_orders")
        .select("order_id,manufacturing_period_exports!inner(id,idempotency_key,status,period_from,period_to,time_zone)")
        .in("order_id", blockedOrderIds.slice(offset, offset + 200)).is("released_at", null);
      if (ownerResult.error) throw ownerResult.error;
      for (const row of (ownerResult.data as unknown as Record<string, unknown>[]) ?? []) {
        const owner = Array.isArray(row.manufacturing_period_exports) ? row.manufacturing_period_exports[0] : row.manufacturing_period_exports;
        if (owner && typeof owner === "object") blockingRuns.set(String(row.order_id), {
           id: String((owner as Record<string, unknown>).id),
           idempotency_key: String((owner as Record<string, unknown>).idempotency_key),
           status: String((owner as Record<string, unknown>).status),
           period_from: String((owner as Record<string, unknown>).period_from),
           period_to: String((owner as Record<string, unknown>).period_to),
           time_zone: String((owner as Record<string, unknown>).time_zone),
        });
      }
    }
    const missingRecipeEvidence = new Map<string, Record<string, unknown>[]>();
    for (let offset = 0; offset < missingRecipeOrderIds.length; offset += 200) {
      const evidenceResult = await s.from("order_product_resolutions")
        .select("order_id,line_index,raw_name,raw_position,mapping_method,resolution_status,platform_product_id,recipe_id,products(name),recipes(name)")
        .in("order_id", missingRecipeOrderIds.slice(offset, offset + 200)).order("line_index");
      if (evidenceResult.error) throw evidenceResult.error;
      for (const row of (evidenceResult.data as unknown as Record<string, unknown>[]) ?? []) {
        const product = Array.isArray(row.products) ? row.products[0] : row.products as Record<string, unknown> | null;
        const recipe = Array.isArray(row.recipes) ? row.recipes[0] : row.recipes as Record<string, unknown> | null;
        const evidence = missingRecipeEvidence.get(String(row.order_id)) ?? [];
        evidence.push({
          line_index: row.line_index, raw_name: row.raw_name, raw_position: row.raw_position,
          mapping_method: row.mapping_method, resolution_status: row.resolution_status,
          platform_product_id: row.platform_product_id, ingredient_name: product?.name ?? null,
          recipe_id: row.recipe_id, recipe_name: recipe?.name ?? null,
        });
        missingRecipeEvidence.set(String(row.order_id), evidence);
      }
    }
    return {
      available: true,
      products: productionProducts,
      odooProducts: odooProducts.data ?? [],
      recipes: recipeCandidates.map((recipe) => ({ id: recipe.id, name: recipe.name })),
      defaults: (defaults.data ?? []).map((row) => ({ ...row, quantity: Number(row.quantity) })),
      settings: settings.data,
      warehouses: warehouses.data ?? [],
      stockSnapshot: snapshot.data && typeof snapshot.data === "object" ? {
        checkedAt: String(snapshot.data.checked_at),
        warehouseProductObservedAt: snapshot.data.warehouse_product_observed_at == null ? null : String(snapshot.data.warehouse_product_observed_at),
        lotStockObservedAt: snapshot.data.lot_stock_observed_at == null ? null : String(snapshot.data.lot_stock_observed_at),
        warehouseProductRows: Number(snapshot.data.warehouse_product_rows ?? 0),
        lotStockRows: Number(snapshot.data.lot_stock_rows ?? 0),
        products: Number(snapshot.data.products ?? 0), trackedProducts: Number(snapshot.data.tracked_products ?? 0),
        warehouses: Number(snapshot.data.warehouses ?? 0),
        warehouseRows: objectRecords(snapshot.data.warehouse_rows).map((row) => ({
          odoo_warehouse_id: Number(row.odoo_warehouse_id), name: String(row.name),
          stock_location_id: row.stock_location_id == null ? null : Number(row.stock_location_id),
          product_rows: Number(row.product_rows ?? 0), lot_rows: Number(row.lot_rows ?? 0),
        })),
        latestRequest: latestRequest.data ? {
          id: String(latestRequest.data.id), status: String(latestRequest.data.status), requested_at: String(latestRequest.data.requested_at),
          claimed_at: latestRequest.data.claimed_at == null ? null : String(latestRequest.data.claimed_at),
          completed_at: latestRequest.data.completed_at == null ? null : String(latestRequest.data.completed_at),
          attempts: Number(latestRequest.data.attempts),
          result: latestRequest.data.result && typeof latestRequest.data.result === "object" ? latestRequest.data.result as Record<string, unknown> : null,
          error: latestRequest.data.error == null ? null : String(latestRequest.data.error),
        } : null,
      } : null,
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
            const orderId = String(item.order_id ?? "");
            const owner = item.problem_code === "already_in_production_run" ? blockingRuns.get(orderId) : undefined;
            const ingredient = item.platform_product_id ? productionProductsById.get(String(item.platform_product_id)) : undefined;
            const resolutionEvidence = item.problem_code === "missing_recipe" ? missingRecipeEvidence.get(orderId) ?? objectRecords(item.resolution_evidence) : [];
            const inferredProductIds = resolutionEvidence.filter((line) => line.resolution_status !== "ignored").map((line) => {
              if (line.platform_product_id) return String(line.platform_product_id);
              const matches = productsByName.get(normalizeObservedName(String(line.raw_name ?? ""))) ?? [];
              return matches.length === 1 ? matches[0] : null;
            }).filter((id): id is string => Boolean(id));
            const recipeSuggestions = rankRecipeMatches(inferredProductIds, recipeCandidates).slice(0, 5);
            return {
              ...item,
              ...(ingredient ? {
                ingredient_name: ingredient.name, ingredient_odoo_id: ingredient.odoo_id,
                odoo_stock_uom: ingredient.odoo_stock_uom,
                package_content_quantity: ingredient.package_content_quantity,
                package_content_uom: ingredient.package_content_uom,
              } : {}),
              ...(item.problem_code === "missing_recipe" ? {
                resolution_evidence: resolutionEvidence,
                recipe_suggestions: recipeSuggestions,
              } : {}),
              ...(owner ? {
                blocking_export_id: owner.id, blocking_idempotency_key: owner.idempotency_key, blocking_status: owner.status,
                blocking_period_from: owner.period_from, blocking_period_to: owner.period_to, blocking_time_zone: owner.time_zone,
              } : {}),
            };
          }),
          replenishment_result: row.replenishment_result && typeof row.replenishment_result === "object" ? row.replenishment_result as Record<string, unknown> : null,
          odoo_result: row.odoo_result && typeof row.odoo_result === "object" ? row.odoo_result as Record<string, unknown> : null,
          order_count: Number(membershipCount?.count ?? 0), created_at: String(row.created_at), replenishment_confirmed_at: row.replenishment_confirmed_at as string | null,
          confirmed_at: row.confirmed_at as string | null, updated_at: String(row.updated_at),
        };
      }),
    };
  } catch {
    return empty;
  }
}
