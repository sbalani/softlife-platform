import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalJson, decodeSyncCursor, encodeSyncCursor, isSyncCursor, localDateTimeToUtc,
  normalizeObservedName, productionDocumentDate, sha256, type SyncCursor,
} from "../odoo-sync-contract.ts";

export class OdooContractError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type CatalogPosition = SyncCursor | "done" | null;
type CatalogCursor = { ingredients: CatalogPosition; recipes: CatalogPosition; updatedAfter: string | null };
type PeriodInput = { idempotencyKey: string; localFrom: string; localTo: string; timeZone: string; initiatedBy: "odoo" | "platform" };
type ProductRow = {
  id: string; name: string; type: string; consumption_type: string | null; odoo_id: number | null;
  default_portion_size: number | null; default_portion_uom: string | null; updated_at: string;
  product_aliases: { alias: string; normalized_alias: string }[] | null;
};
type Resolution = {
  lineIndex: number; rawName: string; normalizedName: string; rawPosition: string | null;
  productId: string | null; recipeId: string | null; recipeVersionId: string | null;
  menuKind: "diy" | "unify" | null;
  method: string; status: "resolved" | "pending" | "ignored"; problemCode: string | null;
};
type RecipeVersionComponent = {
  platform_product_id: string | null; odoo_product_id: number | null;
  quantity: number; uom: unknown; sequence: number;
};

function catalogCursor(value: unknown): value is CatalogCursor {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (row.ingredients === null || row.ingredients === "done" || isSyncCursor(row.ingredients))
    && (row.recipes === null || row.recipes === "done" || isSyncCursor(row.recipes))
    && (row.updatedAfter === null || typeof row.updatedAfter === "string");
}

function limitValue(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new OdooContractError("limit must be a positive integer");
  return Math.min(parsed, maximum);
}

function applyCursor<T>(query: T, cursor: SyncCursor | null, field = "updated_at") {
  if (!cursor) return query;
  return (query as T & { or(value: string): T }).or(`${field}.gt.${cursor.timestamp},and(${field}.eq.${cursor.timestamp},id.gt.${cursor.id})`);
}

function nextRowCursor(rows: Record<string, unknown>[], hasMore: boolean, field = "updated_at"): SyncCursor | null {
  if (!hasMore || !rows.length) return null;
  const row = rows.at(-1)!;
  return { timestamp: String(row[field]), id: String(row.id) };
}

export async function getOdooCatalog(s: SupabaseClient, url: URL) {
  const limit = limitValue(url.searchParams.get("limit"), 500, 500);
  const rawCursor = url.searchParams.get("cursor");
  const requestedUpdatedAfter = url.searchParams.get("updated_after");
  const cursor = rawCursor ? decodeSyncCursor(rawCursor, catalogCursor) : { ingredients: null, recipes: null, updatedAfter: requestedUpdatedAfter };
  if (rawCursor && !cursor) throw new OdooContractError("Invalid cursor", 400, "invalid_cursor");
  if (rawCursor && requestedUpdatedAfter !== null && requestedUpdatedAfter !== cursor?.updatedAfter) throw new OdooContractError("Cursor does not match updated_after", 400, "invalid_cursor");
  const updatedAfter = cursor?.updatedAfter ?? requestedUpdatedAfter;
  if (updatedAfter && Number.isNaN(Date.parse(updatedAfter))) throw new OdooContractError("updated_after must be an ISO timestamp");

  let productQuery = s.from("products")
    .select("id,name,type,consumption_type,odoo_id,default_portion_size,default_portion_uom,updated_at,product_aliases(alias,normalized_alias)")
    .order("updated_at").order("id").limit(cursor?.ingredients === "done" ? 0 : limit + 1);
  let versionQuery = s.from("recipe_versions")
    .select("id,recipe_id,version,component_hash,odoo_bom_id,updated_at,recipes(name,odoo_finished_product_id),recipe_version_components(product_id,odoo_product_id,quantity,uom,sequence),recipe_version_odoo_components(odoo_product_id,quantity,uom,sequence)")
    .order("updated_at").order("id").limit(cursor?.recipes === "done" ? 0 : limit + 1);
  if (updatedAfter) { productQuery = productQuery.gt("updated_at", updatedAfter); versionQuery = versionQuery.gt("updated_at", updatedAfter); }
  productQuery = applyCursor(productQuery, isSyncCursor(cursor?.ingredients) ? cursor.ingredients : null);
  versionQuery = applyCursor(versionQuery, isSyncCursor(cursor?.recipes) ? cursor.recipes : null);
  const [productsResult, versionsResult, overrideResult] = await Promise.all([
    productQuery, versionQuery, s.from("production_product_consumption_overrides").select("product_id,quantity,uom"),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (versionsResult.error) throw versionsResult.error;
  if (overrideResult.error) throw overrideResult.error;
  const productRows = ((productsResult.data as unknown as ProductRow[]) ?? []).slice(0, limit);
  const versionRows = ((versionsResult.data as unknown as Record<string, unknown>[]) ?? []).slice(0, limit);
  const overrides = new Map(((overrideResult.data as { product_id: string; quantity: number; uom: string }[]) ?? []).map((row) => [row.product_id, row]));
  const ingredientHasMore = (productsResult.data?.length ?? 0) > limit;
  const recipeHasMore = (versionsResult.data?.length ?? 0) > limit;
  const nextIngredients: CatalogPosition = ingredientHasMore ? nextRowCursor(productRows as unknown as Record<string, unknown>[], true) : "done";
  const nextRecipes: CatalogPosition = recipeHasMore ? nextRowCursor(versionRows, true) : "done";
  const catalogDone = nextIngredients === "done" && nextRecipes === "done";
  return {
    ingredients: productRows.map((product) => {
      const override = overrides.get(product.id);
      return {
        platform_product_id: product.id,
        odoo_product_id: product.odoo_id,
        name: product.name,
        aliases: (product.product_aliases ?? []).map((alias) => alias.alias),
        type: product.type,
        consumption_type: product.consumption_type,
        default_portion: override ? { quantity: Number(override.quantity), uom: override.uom }
          : product.default_portion_size && product.default_portion_uom ? { quantity: Number(product.default_portion_size), uom: product.default_portion_uom } : null,
        updated_at: product.updated_at,
      };
    }),
    recipe_versions: versionRows.map((row) => {
      const recipe = relation(row.recipes);
      const components = mergeRecipeVersionComponents(
        (row.recipe_version_components as Record<string, unknown>[] | null) ?? [],
        (row.recipe_version_odoo_components as Record<string, unknown>[] | null) ?? [],
      );
      return {
        recipe_id: row.recipe_id,
        recipe_version_id: row.id,
        version: row.version,
        name: recipe?.name,
        odoo_finished_product_id: recipe?.odoo_finished_product_id ?? null,
        odoo_bom_id: row.odoo_bom_id ?? null,
        component_hash: row.component_hash,
        components: components.map((component) => ({
          platform_product_id: component.platform_product_id,
          odoo_product_id: component.odoo_product_id,
          quantity: component.quantity,
          uom: component.uom,
        })),
        updated_at: row.updated_at,
      };
    }),
    next_cursor: catalogDone ? null : encodeSyncCursor({ ingredients: nextIngredients, recipes: nextRecipes, updatedAfter }),
    has_more: !catalogDone,
  };
}

export function mergeRecipeVersionComponents(
  foodComponents: Record<string, unknown>[],
  odooComponents: Record<string, unknown>[],
): RecipeVersionComponent[] {
  return [
    ...foodComponents.map((component) => ({
      platform_product_id: String(component.product_id),
      odoo_product_id: Number(component.odoo_product_id) || null,
      quantity: Number(component.quantity), uom: component.uom, sequence: Number(component.sequence),
    })),
    ...odooComponents.map((component) => ({
      platform_product_id: null,
      odoo_product_id: Number(component.odoo_product_id),
      quantity: Number(component.quantity), uom: component.uom, sequence: Number(component.sequence),
    })),
  ].sort((a, b) => a.sequence - b.sequence);
}

function relation(value: unknown): Record<string, unknown> | null {
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
}

export async function recordOdooRecipeResult(s: SupabaseClient, body: Record<string, unknown>) {
  const versionId = String(body.recipe_version_id ?? "");
  const componentHash = String(body.component_hash ?? "");
  if (typeof body.accepted !== "boolean") throw new OdooContractError("accepted must be boolean");
  const accepted = body.accepted;
  if (!/^[0-9a-f-]{36}$/i.test(versionId) || !componentHash) throw new OdooContractError("recipe_version_id and component_hash are required");
  const { data: version, error } = await s.from("recipe_versions").select("id,recipe_id,component_hash,odoo_bom_id,recipes(odoo_finished_product_id)").eq("id", versionId).maybeSingle();
  if (error) throw error;
  if (!version) throw new OdooContractError("Recipe version not found", 404, "not_found");
  if (version.component_hash !== componentHash) throw new OdooContractError("Stale component hash", 409, "hash_mismatch");
  if (!accepted) return { accepted: false, recipe_version_id: versionId, error: typeof body.error === "string" ? body.error : "Odoo rejected the recipe" };
  const productId = Number(body.odoo_finished_product_id);
  const bomId = Number(body.odoo_bom_id);
  if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(bomId) || bomId <= 0) throw new OdooContractError("Valid Odoo product and BOM IDs are required");
  const { error: resultError } = await s.rpc("record_recipe_odoo_result", {
    p_recipe_version_id: versionId, p_component_hash: componentHash,
    p_odoo_finished_product_id: productId, p_odoo_bom_id: bomId,
  });
  if (resultError) {
    if (["P0001", "P0002"].includes(resultError.code)) throw new OdooContractError(resultError.message, 409, resultError.code === "P0002" ? "hash_mismatch" : "result_conflict");
    throw resultError;
  }
  return { accepted: true, recipe_version_id: versionId, odoo_finished_product_id: productId, odoo_bom_id: bomId };
}

export function parsePeriodInput(body: Record<string, unknown>): PeriodInput & { periodFrom: string; periodTo: string; documentDate: string; fingerprint: string } {
  if (body.initiated_by !== "odoo" && body.initiated_by !== "platform") throw new OdooContractError("initiated_by must be odoo or platform");
  const input: PeriodInput = {
    idempotencyKey: String(body.idempotency_key ?? "").trim(), localFrom: String(body.local_from ?? ""),
    localTo: String(body.local_to ?? ""), timeZone: String(body.time_zone ?? ""),
    initiatedBy: body.initiated_by,
  };
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new OdooContractError("A bounded idempotency_key is required");
  let periodFrom: string;
  let periodTo: string;
  try {
    periodFrom = localDateTimeToUtc(input.localFrom, input.timeZone);
    periodTo = localDateTimeToUtc(input.localTo, input.timeZone);
  } catch (error) {
    throw new OdooContractError(error instanceof Error ? error.message : "Invalid production period");
  }
  if (periodTo <= periodFrom) throw new OdooContractError("period_to must be after period_from");
  const fingerprint = sha256({ periodFrom, periodTo, timeZone: input.timeZone, initiatedBy: input.initiatedBy });
  return { ...input, periodFrom, periodTo, documentDate: productionDocumentDate(input.localTo), fingerprint };
}

function rawLines(order: Record<string, unknown>) {
  const products = Array.isArray(order.products) ? order.products as Record<string, unknown>[] : [];
  return products.length ? products : [{ goodsName: order.product_name }];
}

function saleCandidate(order: Record<string, unknown>) {
  const state = String(order.order_state ?? "").toUpperCase();
  const refund = String(order.refund_status ?? "").toLowerCase();
  return ["3", "COMPLETE"].includes(state) && !["1", "refunded"].includes(refund) && !["自动制作", "Admin override"].includes(String(order.pay_type_raw ?? ""));
}

function resolveOrderLines(
  order: Record<string, unknown>,
  productsByName: Map<string, ProductRow[]>,
  assignments: Record<string, unknown>[],
  existing: Map<number, Record<string, unknown>>,
  pendingMenuKeys: Set<string>,
): Resolution[] {
  const orderTime = String(order.order_time);
  return rawLines(order).map((line, lineIndex) => {
    const rawName = String(line.goodsName ?? "").trim();
    const normalizedName = normalizeObservedName(rawName);
    const rawPosition = line.position == null ? null : String(line.position);
    const durable = existing.get(lineIndex);
    const durableMatchesEvidence = durable
      && String(durable.raw_name ?? "").trim() === rawName
      && String(durable.normalized_name ?? "") === normalizedName
      && (durable.raw_position == null ? null : String(durable.raw_position)) === rawPosition;
    if (durableMatchesEvidence && ["resolved", "ignored"].includes(String(durable.resolution_status))) return {
      lineIndex, rawName, normalizedName, rawPosition,
      productId: durable.platform_product_id == null ? null : String(durable.platform_product_id),
      recipeId: durable.recipe_id == null ? null : String(durable.recipe_id),
      recipeVersionId: durable.recipe_version_id == null ? null : String(durable.recipe_version_id),
      menuKind: durable.menu_kind === "diy" || durable.menu_kind === "unify" ? durable.menu_kind : null,
      method: String(durable.mapping_method), status: durable.resolution_status as "resolved" | "ignored", problemCode: durable.problem_code == null ? null : String(durable.problem_code),
    };
    if (rawPosition && ["diy", "unify"].some((kind) => pendingMenuKeys.has(`${String(order.machine_id)}:${kind}:${rawPosition}`))) {
      return { lineIndex, rawName, normalizedName, rawPosition, productId: null, recipeId: null, recipeVersionId: null, menuKind: null, method: "unresolved", status: "pending", problemCode: "menu_assignment_pending" };
    }
    const menuAssignments = rawPosition ? assignments.filter((assignment) => assignment.machine_id === order.machine_id
      && String(assignment.menu_position) === rawPosition && String(assignment.valid_from) <= orderTime
      && (!assignment.valid_to || String(assignment.valid_to) > orderTime)
      && normalizeObservedName(String(relation(assignment.recipes)?.name ?? "")) === normalizedName) : [];
    if (menuAssignments.length === 1) return { lineIndex, rawName, normalizedName, rawPosition, productId: null, recipeId: String(menuAssignments[0].recipe_id), recipeVersionId: null, menuKind: menuAssignments[0].menu_kind as "diy" | "unify", method: "menu_recipe_assignment", status: "resolved", problemCode: null };
    if (menuAssignments.length > 1) return { lineIndex, rawName, normalizedName, rawPosition, productId: null, recipeId: null, recipeVersionId: null, menuKind: null, method: "unresolved", status: "pending", problemCode: "ambiguous_ingredient_name" };
    const matches = productsByName.get(normalizedName) ?? [];
    if (matches.length === 1) return { lineIndex, rawName, normalizedName, rawPosition, productId: matches[0].id, recipeId: null, recipeVersionId: null, menuKind: null, method: normalizeObservedName(matches[0].name) === normalizedName ? "canonical_ingredient_name" : "ingredient_alias", status: "resolved", problemCode: null };
    return { lineIndex, rawName, normalizedName, rawPosition, productId: null, recipeId: null, recipeVersionId: null, menuKind: null, method: "unresolved", status: "pending", problemCode: matches.length ? "ambiguous_ingredient_name" : "unknown_ingredient_name" };
  });
}

function orderSourceSnapshot(order: Record<string, unknown>) {
  return canonicalJson({
    order_state: order.order_state, status_code: order.status_code, order_time: order.order_time,
    price: order.price, products: order.products, product_name: order.product_name, nums: order.nums,
    pay_type_raw: order.pay_type_raw, refund_status: order.refund_status, machine_id: order.machine_id,
    device_imei: order.device_imei, odoo_warehouse_id_at_sale: order.odoo_warehouse_id_at_sale, currency: order.currency,
  });
}

async function createRecipeVersion(s: SupabaseClient, recipeId: string, machineId: string, context: {
  products: Map<string, ProductRow>; defaults: Map<string, { quantity: number; uom: string }>;
  productOverrides: Map<string, { quantity: number; uom: string }>; machineOverrides: Map<string, { quantity: number; uom: string }>;
  cupOdooProductId: number | null;
}) {
  const { data: stableRows, error: stableError } = await s.from("recipe_components").select("product_id,sequence").eq("recipe_id", recipeId).order("sequence");
  if (stableError) throw stableError;
  const ids = (stableRows ?? []).map((row) => String(row.product_id));
  const components: { platform_product_id: string | null; odoo_product_id: number; quantity: number; uom: string; sequence: number }[] = [];
  const problems: { problem_code: string; platform_product_id: string | null }[] = [];
  for (const [index, productId] of ids.entries()) {
    const product = context.products.get(productId);
    if (!product) { problems.push({ problem_code: "unknown_ingredient_name", platform_product_id: productId }); continue; }
    const quantity = context.machineOverrides.get(`${machineId}:${productId}`) ?? context.productOverrides.get(productId)
        ?? (product.default_portion_size && product.default_portion_uom ? { quantity: Number(product.default_portion_size), uom: product.default_portion_uom } : undefined)
        ?? (product.consumption_type ? context.defaults.get(product.consumption_type) : undefined);
    if (!quantity) { problems.push({ problem_code: "missing_component_quantity", platform_product_id: productId }); continue; }
    if (!product.odoo_id) { problems.push({ problem_code: "missing_ingredient_odoo_link", platform_product_id: productId }); continue; }
    components.push({
      platform_product_id: productId, odoo_product_id: product.odoo_id,
      quantity: Number(quantity.quantity), uom: quantity.uom.trim(), sequence: index + 1,
    });
  }
  const cupOdooProductId = context.cupOdooProductId;
  if (!cupOdooProductId) problems.push({ problem_code: "missing_cup_odoo_product", platform_product_id: null });
  if (cupOdooProductId && components.some((component) => component.odoo_product_id === cupOdooProductId)) {
    problems.push({ problem_code: "cup_matches_food_ingredient", platform_product_id: null });
  }
  if (problems.length || !cupOdooProductId) return { version: null, components: [], problems };
  const cupComponent = { platform_product_id: null, odoo_product_id: cupOdooProductId, quantity: 1, uom: "unit", sequence: components.length + 1 };
  components.push(cupComponent);
  const { data: version, error } = await s.rpc("create_or_reuse_recipe_version", {
    p_recipe_id: recipeId,
    p_components: components.filter((component) => component.platform_product_id !== null).map((component) => ({ product_id: component.platform_product_id, odoo_product_id: component.odoo_product_id, quantity: component.quantity, uom: component.uom, sequence: component.sequence })),
    p_odoo_components: [{ odoo_product_id: cupComponent.odoo_product_id, quantity: cupComponent.quantity, uom: cupComponent.uom, sequence: cupComponent.sequence }],
  });
  if (error) throw error;
  return { version: relation(version) ?? version as Record<string, unknown>, components, problems: [] };
}

export async function prepareManufacturingPeriod(s: SupabaseClient, body: Record<string, unknown>, caller: "odoo" | "platform" = "odoo") {
  const input = parsePeriodInput(body);
  if (input.initiatedBy !== caller) throw new OdooContractError("The run initiator does not match the authenticated caller", 403, "wrong_initiator");
  const { data: existing, error: existingError } = await s.from("manufacturing_period_exports").select("*").eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existingError) throw existingError;
  if (existing && existing.request_fingerprint !== input.fingerprint) throw new OdooContractError("Idempotency key already exists with different boundaries", 409, "idempotency_conflict");
  if (existing && ["draft", "ready", "processing", "completed", "cancelled"].includes(String(existing.status))) return presentManufacturingExport(existing as Record<string, unknown>);
  if (existing?.status === "failed" && existing.odoo_result) return presentManufacturingExport(existing as Record<string, unknown>);
  if (existing?.status === "preparing" && Date.now() - Date.parse(String(existing.updated_at)) < 5 * 60_000) return presentManufacturingExport(existing as Record<string, unknown>);

  let exportId = existing?.id as string | undefined;
  if (!exportId) {
    const { data: inserted, error } = await s.from("manufacturing_period_exports").insert({
      idempotency_key: input.idempotencyKey, request_fingerprint: input.fingerprint, initiated_by: input.initiatedBy,
      period_from: input.periodFrom, period_to: input.periodTo, time_zone: input.timeZone, document_date: input.documentDate, status: "preparing",
    }).select("id").single();
    if (error) {
      if (error.code === "23505") {
        const { data: concurrent, error: concurrentError } = await s.from("manufacturing_period_exports").select("*").eq("idempotency_key", input.idempotencyKey).maybeSingle();
        if (concurrentError) throw concurrentError;
        if (concurrent?.request_fingerprint === input.fingerprint) return presentManufacturingExport(concurrent as Record<string, unknown>);
        throw new OdooContractError("The period overlaps a concurrent request", 409, "idempotency_conflict");
      }
      throw error;
    }
    exportId = inserted.id;
  } else {
    const { error } = await s.rpc("claim_manufacturing_export_preparation", { p_export_id: exportId, p_expected_updated_at: existing.updated_at });
    if (error) {
      if (error.code === "P0001") throw new OdooContractError("The production run changed while preparation was starting", 409, "invalid_status");
      throw error;
    }
  }

  try {
    const orderRows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await s.from("huaxin_orders").select("id,order_code,order_time,order_state,status_code,price,products,product_name,nums,pay_type_raw,refund_status,machine_id,device_imei,export_version,export_content_hash,odoo_warehouse_id_at_sale,currency,machines(name)")
        .gte("order_time", input.periodFrom).lt("order_time", input.periodTo).order("order_time").order("id").range(offset, offset + 999);
      if (error) throw error;
      orderRows.push(...((data as Record<string, unknown>[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    const orders = orderRows.filter(saleCandidate);
    const machineIds = [...new Set(orders.map((order) => order.machine_id as string).filter(Boolean))];
    const existingResolutions = new Map<string, Map<number, Record<string, unknown>>>();
    for (let offset = 0; offset < orders.length; offset += 200) {
      const ids = orders.slice(offset, offset + 200).map((order) => String(order.id));
      const { data, error } = await s.from("order_product_resolutions").select("order_id,line_index,raw_name,normalized_name,raw_position,menu_kind,platform_product_id,recipe_id,recipe_version_id,mapping_method,resolution_status,problem_code,resolution_note,resolved_by,resolved_at").in("order_id", ids);
      if (error) throw error;
      for (const row of (data as Record<string, unknown>[]) ?? []) {
        const byLine = existingResolutions.get(String(row.order_id)) ?? new Map<number, Record<string, unknown>>();
        byLine.set(Number(row.line_index), row);
        existingResolutions.set(String(row.order_id), byLine);
      }
    }
    const [productsResult, assignmentsResult, defaultsResult, productOverridesResult, machineOverridesResult, settingsResult, warehousesResult, membershipsResult, pendingPushesResult] = await Promise.all([
      s.from("products").select("id,name,type,consumption_type,odoo_id,default_portion_size,default_portion_uom,updated_at,product_aliases(alias,normalized_alias)"),
      machineIds.length ? s.from("machine_menu_recipe_assignments").select("machine_id,menu_kind,menu_position,recipe_id,valid_from,valid_to,recipes(name)").in("machine_id", machineIds).lt("valid_from", input.periodTo).or(`valid_to.is.null,valid_to.gt.${input.periodFrom}`) : Promise.resolve({ data: [], error: null }),
      s.from("production_consumption_defaults").select("consumption_type,quantity,uom"),
      s.from("production_product_consumption_overrides").select("product_id,quantity,uom"),
      machineIds.length ? s.from("machine_product_consumption_overrides").select("machine_id,product_id,quantity,uom").in("machine_id", machineIds) : Promise.resolve({ data: [], error: null }),
      s.from("production_settings").select("cup_odoo_product_id,currency").eq("singleton", true).single(),
      s.from("odoo_warehouses").select("odoo_id,name,sales_customer_odoo_id"),
      orders.length ? s.from("manufacturing_period_export_orders").select("order_id,export_id").in("order_id", orders.map((order) => order.id as string)).is("released_at", null) : Promise.resolve({ data: [], error: null }),
      machineIds.length ? s.from("menu_recipe_push_operations").select("machine_id,assignments").in("machine_id", machineIds).eq("status", "pending") : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [productsResult, assignmentsResult, defaultsResult, productOverridesResult, machineOverridesResult, settingsResult, warehousesResult, membershipsResult, pendingPushesResult]) if (result.error) throw result.error;
    if (!settingsResult.data) throw new OdooContractError("Production settings are unavailable", 503, "not_configured");
    const settings = settingsResult.data;
    const products = (productsResult.data as unknown as ProductRow[]) ?? [];
    const productsById = new Map(products.map((product) => [product.id, product]));
    const productsByName = new Map<string, ProductRow[]>();
    for (const product of products) {
      const keys = [normalizeObservedName(product.name), ...(product.product_aliases ?? []).map((alias) => alias.normalized_alias || normalizeObservedName(alias.alias))];
      for (const key of keys) {
        const matches = productsByName.get(key) ?? [];
        if (!matches.some((match) => match.id === product.id)) productsByName.set(key, [...matches, product]);
      }
    }
    const defaults = new Map(((defaultsResult.data as { consumption_type: string; quantity: number; uom: string }[]) ?? []).map((row) => [row.consumption_type, { quantity: Number(row.quantity), uom: row.uom }]));
    const productOverrides = new Map(((productOverridesResult.data as { product_id: string; quantity: number; uom: string }[]) ?? []).map((row) => [row.product_id, { quantity: Number(row.quantity), uom: row.uom }]));
    const machineOverrides = new Map(((machineOverridesResult.data as { machine_id: string; product_id: string; quantity: number; uom: string }[]) ?? []).map((row) => [`${row.machine_id}:${row.product_id}`, { quantity: Number(row.quantity), uom: row.uom }]));
    const warehouseMap = new Map(((warehousesResult.data as { odoo_id: number; name: string; sales_customer_odoo_id: number | null }[]) ?? []).map((row) => [row.odoo_id, row]));
    const occupied = new Map(((membershipsResult.data as { order_id: string; export_id: string }[]) ?? []).filter((row) => row.export_id !== exportId).map((row) => [row.order_id, row.export_id]));
    const pendingMenuKeys = new Set<string>();
    for (const operation of (pendingPushesResult.data as { machine_id: string; assignments: Record<string, unknown>[] }[]) ?? []) {
      for (const assignment of operation.assignments ?? []) pendingMenuKeys.add(`${operation.machine_id}:${String(assignment.menu_kind)}:${String(assignment.menu_position)}`);
    }
    const blocked: Record<string, unknown>[] = [];
    if (orders.length === 0) blocked.push({
      problem_code: "no_eligible_orders",
      message: "No completed, non-refunded customer orders exist in the selected period.",
      raw_order_count: orderRows.length,
    });
    const groups = new Map<string, Record<string, unknown>>();
    const resolutionRows: Record<string, unknown>[] = [];

    for (const order of orders) {
      const orderId = String(order.id);
      const machineId = String(order.machine_id ?? "");
      const machineName = String(relation(order.machines)?.name ?? order.device_imei ?? "Unknown machine");
      const orderCode = String(order.order_code);
      if (occupied.has(orderId)) { blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, problem_code: "already_in_production_run", blocking_export_id: occupied.get(orderId) }); continue; }
      if (!Number.isInteger(Number(order.nums)) || Number(order.nums) <= 0) { blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, problem_code: "invalid_units" }); continue; }
      const priorByLine = existingResolutions.get(orderId) ?? new Map();
      const resolutions = resolveOrderLines(order, productsByName, (assignmentsResult.data as unknown as Record<string, unknown>[]) ?? [], priorByLine, pendingMenuKeys);
      for (const resolution of resolutions) {
        const prior = priorByLine.get(resolution.lineIndex);
        const priorMatchesEvidence = prior
          && String(prior.raw_name ?? "").trim() === resolution.rawName
          && String(prior.normalized_name ?? "") === resolution.normalizedName
          && (prior.raw_position == null ? null : String(prior.raw_position)) === resolution.rawPosition;
        resolutionRows.push({
          order_id: orderId, line_index: resolution.lineIndex, raw_name: resolution.rawName, normalized_name: resolution.normalizedName,
          raw_position: resolution.rawPosition, menu_kind: resolution.menuKind, platform_product_id: resolution.productId, recipe_id: resolution.recipeId, recipe_version_id: resolution.recipeVersionId,
          mapping_method: resolution.method, resolution_status: resolution.status, problem_code: resolution.problemCode,
          resolved_at: priorMatchesEvidence && ["resolved", "ignored"].includes(String(prior?.resolution_status))
            ? prior?.resolved_at ?? null
            : resolution.status === "resolved" ? new Date().toISOString() : null,
          ...(prior && !priorMatchesEvidence ? { resolution_note: null, resolved_by: null } : {}),
        });
      }
      const pending = resolutions.find((resolution) => resolution.status === "pending");
      if (pending) { blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, raw_text: pending.rawName, problem_code: pending.problemCode }); continue; }
      const activeResolutions = resolutions.filter((resolution) => resolution.status !== "ignored");
      const recipeIds = [...new Set(activeResolutions.map((resolution) => resolution.recipeId).filter((id): id is string => Boolean(id)))];
      const productIds = [...new Set(activeResolutions.map((resolution) => resolution.productId).filter((id): id is string => Boolean(id)))];
      let recipeId: string;
      if (recipeIds.length === 1 && productIds.length === 0) recipeId = recipeIds[0];
      else if (recipeIds.length === 0 && activeResolutions.length > 0 && productIds.length === activeResolutions.length) {
        const displayName = productIds.map((id) => productsById.get(id)?.name).filter(Boolean).join(" + ");
        const { data, error } = await s.rpc("create_or_reuse_recipe", { p_product_ids: productIds, p_name: displayName });
        if (error) throw error;
        recipeId = String(data);
      } else { blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, problem_code: "missing_recipe" }); continue; }
      const warehouseId = Number(order.odoo_warehouse_id_at_sale);
      const warehouse = warehouseMap.get(warehouseId);
      if (!warehouseId || !warehouse) { blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, problem_code: "missing_warehouse_assignment" }); continue; }
      if (!warehouse.sales_customer_odoo_id) { blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, problem_code: "missing_warehouse_customer", odoo_warehouse_id: warehouseId }); continue; }
      const currency = String(order.currency ?? settings.currency ?? "EUR");
      if (currency !== settings.currency) { blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, problem_code: "currency_mismatch", currency, expected_currency: settings.currency }); continue; }
      const versionResult = await createRecipeVersion(s, recipeId, machineId, { products: productsById, defaults, productOverrides, machineOverrides, cupOdooProductId: settings.cup_odoo_product_id == null ? null : Number(settings.cup_odoo_product_id) });
      if (!versionResult.version) { for (const problem of versionResult.problems) blocked.push({ order_id: orderId, order_code: orderCode, machine: machineName, ...problem }); continue; }
      for (const row of resolutionRows) if (row.order_id === orderId && row.resolution_status !== "ignored") {
        row.recipe_id = recipeId;
        row.recipe_version_id = versionResult.version.id;
      }
      const { data: recipe, error: recipeError } = await s.from("recipes").select("name,odoo_finished_product_id").eq("id", recipeId).single();
      if (recipeError) throw recipeError;
      const groupKey = `${warehouseId}:${versionResult.version.id}:${currency}`;
      const current = groups.get(groupKey) ?? {
        odoo_warehouse_id: warehouseId, odoo_customer_id: warehouse.sales_customer_odoo_id, warehouse_name: warehouse.name,
        recipe_id: recipeId, recipe_version_id: versionResult.version.id, version: versionResult.version.version,
        name: recipe.name, odoo_finished_product_id: recipe.odoo_finished_product_id, units_sold: 0, gross_sales: 0,
        currency, components: versionResult.components,
      };
      current.units_sold = Number(current.units_sold) + Number(order.nums);
      current.gross_sales = Number(current.gross_sales) + Number(order.price ?? 0);
      groups.set(groupKey, current);
    }
    if (resolutionRows.length) {
      const { error } = await s.from("order_product_resolutions").upsert(resolutionRows, { onConflict: "order_id,line_index" });
      if (error) throw error;
    }
    const warehouses = new Map<number, Record<string, unknown>>();
    for (const group of groups.values()) {
      const warehouseId = Number(group.odoo_warehouse_id);
      const warehouse = warehouses.get(warehouseId) ?? { odoo_warehouse_id: warehouseId, odoo_customer_id: group.odoo_customer_id, recipes: [] };
      const components = (group.components as { odoo_product_id: number; quantity: number; uom: string }[]).map((component) => ({
        odoo_product_id: component.odoo_product_id, quantity_per_unit: component.quantity,
        total_quantity: component.quantity * Number(group.units_sold), uom: component.uom,
      }));
      (warehouse.recipes as Record<string, unknown>[]).push({ ...group, components });
      warehouses.set(warehouseId, warehouse);
    }
    const payload = { export_id: exportId, period_from: input.periodFrom, period_to: input.periodTo, time_zone: input.timeZone, document_date: input.documentDate, warehouses: [...warehouses.values()] };
    const payloadHash = sha256(payload);
    const configSnapshot = { defaults: defaultsResult.data, product_overrides: productOverridesResult.data, machine_overrides: machineOverridesResult.data, settings };
    const claimableOrders = orders.filter((order) => !occupied.has(String(order.id)));
    const refreshedOrders = new Map<string, Record<string, unknown>>();
    for (let offset = 0; offset < claimableOrders.length; offset += 200) {
      const ids = claimableOrders.slice(offset, offset + 200).map((order) => String(order.id));
      const { data, error } = await s.from("huaxin_orders").select("id,order_state,status_code,order_time,price,products,product_name,nums,pay_type_raw,refund_status,machine_id,device_imei,odoo_warehouse_id_at_sale,currency,export_version,export_content_hash").in("id", ids);
      if (error) throw error;
      for (const row of (data as Record<string, unknown>[]) ?? []) refreshedOrders.set(String(row.id), row);
    }
    for (const order of claimableOrders) {
      const refreshed = refreshedOrders.get(String(order.id));
      if (!refreshed || orderSourceSnapshot(refreshed) !== orderSourceSnapshot(order)) {
        throw new OdooContractError("An order changed during production preparation; retry the request", 409, "order_changed");
      }
    }
    const expectedOrders = claimableOrders.map((order) => {
      const refreshed = refreshedOrders.get(String(order.id))!;
      return { order_id: order.id, export_version: refreshed.export_version, export_content_hash: refreshed.export_content_hash };
    });
    const { data: saved, error: saveError } = await s.rpc("finalize_manufacturing_export", {
      p_export_id: exportId, p_expected_orders: expectedOrders, p_payload: payload,
      p_payload_sha256: payloadHash, p_config_snapshot: configSnapshot, p_blocked_reasons: blocked,
    });
    if (saveError) {
      if (["P0003", "P0004"].includes(saveError.code)) throw new OdooContractError(saveError.message, 409, saveError.code === "P0003" ? "order_changed" : "period_overlap");
      throw saveError;
    }
    return presentManufacturingExport(relation(saved) ?? saved as Record<string, unknown>);
  } catch (error) {
    await s.from("manufacturing_period_exports").update({ status: "failed", blocked_reasons: [{ problem_code: "preparation_failed", message: error instanceof Error ? error.message : String(error) }] }).eq("id", exportId);
    throw error;
  }
}

export function presentManufacturingExport(row: Record<string, unknown>) {
  const payload = (row.payload as Record<string, unknown> | null) ?? {};
  return {
    export_id: row.id, idempotency_key: row.idempotency_key, initiated_by: row.initiated_by, status: row.status,
    period_from: row.period_from, period_to: row.period_to, time_zone: row.time_zone, document_date: row.document_date,
    payload_sha256: row.payload_sha256, warehouses: payload.warehouses ?? [], blocked_items: row.blocked_reasons ?? [],
    odoo_result: row.odoo_result ?? null, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function listManufacturingPeriods(s: SupabaseClient, url: URL) {
  const limit = limitValue(url.searchParams.get("limit"), 100, 100);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeSyncCursor(rawCursor, isSyncCursor);
  if (rawCursor && !cursor) throw new OdooContractError("Invalid cursor", 400, "invalid_cursor");
  let query = s.from("manufacturing_period_exports").select("*").order("updated_at").order("id").limit(limit + 1);
  query = applyCursor(query, cursor);
  const { data, error } = await query;
  if (error) throw error;
  const rows = ((data as Record<string, unknown>[]) ?? []).slice(0, limit);
  const hasMore = (data?.length ?? 0) > limit;
  return { runs: rows.map(presentManufacturingExport), next_cursor: hasMore ? encodeSyncCursor(nextRowCursor(rows, true)) : null, has_more: hasMore };
}

export async function getManufacturingPeriod(s: SupabaseClient, exportId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new OdooContractError("Invalid export ID");
  const { data, error } = await s.from("manufacturing_period_exports").select("*").eq("id", exportId).maybeSingle();
  if (error) throw error;
  if (!data) throw new OdooContractError("Production run not found", 404, "not_found");
  return presentManufacturingExport(data as Record<string, unknown>);
}

export async function confirmManufacturingPeriod(s: SupabaseClient, exportId: string, body: Record<string, unknown>, caller: "odoo" | "platform" = "odoo") {
  const hash = String(body.payload_sha256 ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(exportId) || !/^[0-9a-f]{64}$/i.test(hash)) throw new OdooContractError("Valid export ID and payload hash are required");
  const { data, error } = await s.rpc("confirm_manufacturing_export", { p_export_id: exportId, p_payload_sha256: hash, p_caller: caller });
  if (error) {
    if (["P0001", "P0002", "P0003", "P0005"].includes(error.code)) throw new OdooContractError(error.message, error.code === "P0005" ? 403 : 409, error.code === "P0002" ? "hash_mismatch" : error.code === "P0003" ? "order_changed" : error.code === "P0005" ? "wrong_initiator" : "invalid_status");
    throw error;
  }
  return presentManufacturingExport(relation(data) ?? data as Record<string, unknown>);
}

export async function cancelUnconfirmedManufacturingPeriod(s: SupabaseClient, exportId: string, caller: "odoo" | "platform" = "odoo") {
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new OdooContractError("Valid export ID is required");
  const { data, error } = await s.rpc("cancel_unconfirmed_manufacturing_export", { p_export_id: exportId, p_caller: caller });
  if (error) {
    if (["P0001", "P0005"].includes(error.code)) throw new OdooContractError(error.message, error.code === "P0005" ? 403 : 409, error.code === "P0005" ? "wrong_initiator" : "invalid_status");
    throw error;
  }
  return presentManufacturingExport(relation(data) ?? data as Record<string, unknown>);
}

export async function recordManufacturingPeriodResult(s: SupabaseClient, exportId: string, body: Record<string, unknown>) {
  const hash = String(body.payload_sha256 ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(exportId) || !/^[0-9a-f]{64}$/i.test(hash)) throw new OdooContractError("Valid export ID and payload hash are required");
  if (typeof body.accepted !== "boolean") throw new OdooContractError("accepted must be boolean");
  if (canonicalJson(body).length > 100_000) throw new OdooContractError("Result payload is too large", 413, "payload_too_large");
  const { data: run, error: runError } = await s.from("manufacturing_period_exports").select("payload").eq("id", exportId).maybeSingle();
  if (runError) throw runError;
  if (!run) throw new OdooContractError("Production run not found", 404, "not_found");
  validateManufacturingResult(body, run.payload as Record<string, unknown> | null);
  const { data, error } = await s.rpc("record_manufacturing_export_result", { p_export_id: exportId, p_payload_sha256: hash, p_result: body });
  if (error) {
    if (["P0001", "P0002"].includes(error.code)) throw new OdooContractError(error.message, 409, error.code === "P0002" ? "hash_mismatch" : "result_conflict");
    throw error;
  }
  return presentManufacturingExport(relation(data) ?? data as Record<string, unknown>);
}

export function validateManufacturingResult(body: Record<string, unknown>, payload: Record<string, unknown> | null) {
  if (body.accepted === false) {
    if (typeof body.error !== "string" || !body.error.trim() || body.error.length > 5000) throw new OdooContractError("A bounded error is required for a rejected result");
    return;
  }
  const expected = new Map(((payload?.warehouses as Record<string, unknown>[] | undefined) ?? []).map((warehouse) => [
    Number(warehouse.odoo_warehouse_id),
    Array.isArray(warehouse.recipes) ? warehouse.recipes.length : 0,
  ]));
  const rows = Array.isArray(body.warehouses) ? body.warehouses as Record<string, unknown>[] : [];
  const received = new Set<number>();
  const receivedManufacturingIds = new Set<number>();
  const receivedSalesOrderIds = new Set<number>();
  const receivedDeliveryIds = new Set<number>();
  for (const row of rows) {
    const warehouseId = Number(row.odoo_warehouse_id);
    const manufacturingIds = Array.isArray(row.manufacturing_order_ids) ? row.manufacturing_order_ids.map(Number) : [];
    const salesOrderId = Number(row.sales_order_id);
    const deliveryId = Number(row.delivery_id);
    if (!expected.has(warehouseId) || received.has(warehouseId) || manufacturingIds.length !== expected.get(warehouseId)
      || manufacturingIds.some((id) => !Number.isInteger(id) || id <= 0)
      || !Number.isInteger(salesOrderId) || salesOrderId <= 0
      || !Number.isInteger(deliveryId) || deliveryId <= 0
      || manufacturingIds.some((id) => receivedManufacturingIds.has(id))
      || new Set(manufacturingIds).size !== manufacturingIds.length
      || receivedSalesOrderIds.has(salesOrderId) || receivedDeliveryIds.has(deliveryId)) {
      throw new OdooContractError("Accepted results require one valid manufacturing, sale, and delivery result per frozen warehouse");
    }
    received.add(warehouseId);
    for (const id of manufacturingIds) receivedManufacturingIds.add(id);
    receivedSalesOrderIds.add(salesOrderId);
    receivedDeliveryIds.add(deliveryId);
  }
  if (received.size !== expected.size) throw new OdooContractError("Accepted result warehouses do not match the frozen payload");
}

export async function getOdooSales(s: SupabaseClient, url: URL) {
  const limit = limitValue(url.searchParams.get("limit"), 500, 500);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeSyncCursor(rawCursor, isSyncCursor);
  if (rawCursor && !cursor) throw new OdooContractError("Invalid cursor", 400, "invalid_cursor");
  let query = s.from("huaxin_orders").select("id,order_code,export_version,export_updated_at,export_content_hash,order_time,time_zone,order_state,status_code,refund_status,pay_type_raw,nums,price,currency,machine_id,device_imei,odoo_warehouse_id_at_sale,products,product_name,machines(name),order_product_resolutions(line_index,raw_name,normalized_name,raw_position,menu_kind,platform_product_id,recipe_id,recipe_version_id,mapping_method,resolution_status,problem_code,products(odoo_id))")
    .order("export_updated_at").order("id").limit(limit + 1);
  query = applyCursor(query, cursor, "export_updated_at");
  const { data, error } = await query;
  if (error) throw error;
  const rows = ((data as unknown as Record<string, unknown>[]) ?? []).slice(0, limit);
  const hasMore = (data?.length ?? 0) > limit;
  return {
    sales: rows.map((order) => ({
      platform_order_id: order.id, order_code: order.order_code, export_version: order.export_version,
      export_updated_at: order.export_updated_at, export_content_hash: order.export_content_hash,
      order_time: order.order_time, local_date: new Intl.DateTimeFormat("en-CA", { timeZone: String(order.time_zone), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(order.order_time))),
      time_zone: order.time_zone, state: order.order_state,
      refunded: ["1", "refunded"].includes(String(order.refund_status ?? "").toLowerCase()),
      admin_override: ["自动制作", "Admin override"].includes(String(order.pay_type_raw ?? "")),
      units: Number(order.nums), gross_sales: Number(order.price), currency: order.currency,
      machine_id: order.machine_id, machine_imei: order.device_imei, machine_name: relation(order.machines)?.name ?? null,
      odoo_warehouse_id: order.odoo_warehouse_id_at_sale, raw_products: order.products,
      resolutions: ((order.order_product_resolutions as Record<string, unknown>[]) ?? []).map((resolution) => ({
        ...resolution, odoo_product_id: relation(resolution.products)?.odoo_id ?? null, products: undefined,
      })),
    })),
    next_cursor: hasMore ? encodeSyncCursor(nextRowCursor(rows, true, "export_updated_at")) : null,
    has_more: hasMore,
  };
}
