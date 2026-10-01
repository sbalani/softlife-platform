import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "../supabase/server";
import { fiscalCalendarMonth, isFiscalCalendarMonth } from "../odoo-fiscal-invoices.ts";
import { sha256 } from "../odoo-sync-contract.ts";
import type { FiscalSaleLink, FiscalSaleLinkPayload } from "../odoo-fiscal-sale-links.ts";

type SyncRequest = {
  id: string;
  status: string;
  requested_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  attempts: number;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type FiscalSaleLinkAdminData = {
  available: boolean;
  month: string;
  postedCount: number;
  linkedCount: number;
  candidateCount: number;
  deferredCount: number;
  unmapped: string[];
  blockers: string[];
  payload: FiscalSaleLinkPayload | null;
  payloadSha256: string | null;
  latestRequest: SyncRequest | null;
};

const EMPTY = (month: string): FiscalSaleLinkAdminData => ({
  available: false, month, postedCount: 0, linkedCount: 0, candidateCount: 0,
  deferredCount: 0,
  unmapped: [], blockers: ["Apply the fiscal invoice sale-link migration before using this control."],
  payload: null, payloadSha256: null, latestRequest: null,
});

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function requestFromRow(row: Record<string, unknown> | null): SyncRequest | null {
  return row ? {
    id: String(row.id), status: String(row.status), requested_at: String(row.requested_at),
    claimed_at: row.claimed_at == null ? null : String(row.claimed_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at), attempts: Number(row.attempts),
    result: row.result && typeof row.result === "object" && !Array.isArray(row.result) ? row.result as Record<string, unknown> : null,
    error: row.error == null ? null : String(row.error),
  } : null;
}

async function loadMonthDocuments(s: SupabaseClient, first: string, last: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await s.from("fiscal_invoice_documents")
      .select("id,source_order_id,invoice_payload,invoice_payload_sha256,odoo_move_id,odoo_product_id,order_code,status,sale_link_status")
      .gte("invoice_date", first).lte("invoice_date", last).eq("status", "posted")
      .order("invoice_date").order("id").range(offset, offset + 999);
    if (result.error) throw result.error;
    const page = records(result.data);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function loadByChunks(s: SupabaseClient, table: string, columns: string, column: string, values: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < values.length; index += 100) {
    const result = await s.from(table).select(columns).in(column, values.slice(index, index + 100));
    if (result.error) throw result.error;
    rows.push(...records(result.data));
  }
  return rows;
}

function warehouseResults(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return records((value as Record<string, unknown>).warehouses);
}

function warehousePayloads(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return records((value as Record<string, unknown>).warehouses);
}

async function buildFiscalSaleLinkData(s: SupabaseClient, month: string): Promise<FiscalSaleLinkAdminData> {
  if (!isFiscalCalendarMonth(month)) throw new Error("Invalid fiscal calendar month.");
  const { first, last } = fiscalCalendarMonth(month, []);
  const [documents, requestResult, activeResult] = await Promise.all([
    loadMonthDocuments(s, first, last),
    s.from("odoo_sync_requests").select("id,status,requested_at,claimed_at,completed_at,attempts,result,error")
      .eq("kind", "fiscal_invoice_sale_link").order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    s.from("odoo_sync_requests").select("id").eq("kind", "fiscal_invoice_sale_link")
      .in("status", ["pending", "processing"]).limit(1).maybeSingle(),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (activeResult.error) throw activeResult.error;
  const linkedCount = documents.filter((document) => document.sale_link_status === "linked").length;
  const pendingCount = documents.filter((document) => document.sale_link_status === "pending").length;
  const sourceDocuments = documents.filter((document) => ["unlinked", "failed"].includes(String(document.sale_link_status)));
  const sourceOrderIds = [...new Set(sourceDocuments.map((document) => String(document.source_order_id)))];
  const [orders, memberships, resolutions] = await Promise.all([
    loadByChunks(s, "huaxin_orders", "id,odoo_warehouse_id_at_sale", "id", sourceOrderIds),
    loadByChunks(s, "manufacturing_period_export_orders", "export_id,order_id", "order_id", sourceOrderIds),
    loadByChunks(s, "order_product_resolutions", "order_id,recipe_version_id,resolution_status", "order_id", sourceOrderIds),
  ]);
  const exportIds = [...new Set(memberships.map((membership) => String(membership.export_id)))];
  const exports = await loadByChunks(s, "manufacturing_period_exports", "id,status,payload,odoo_result", "id", exportIds);
  const completedExports = new Map(exports.filter((row) => row.status === "completed").map((row) => [String(row.id), row]));
  const warehouseByOrder = new Map(orders.map((row) => [String(row.id), Number(row.odoo_warehouse_id_at_sale)]));
  const membershipsByOrder = new Map<string, Record<string, unknown>[]>();
  const recipesByOrder = new Map<string, Set<string>>();
  for (const membership of memberships) {
    if (!completedExports.has(String(membership.export_id))) continue;
    const orderId = String(membership.order_id);
    membershipsByOrder.set(orderId, [...(membershipsByOrder.get(orderId) ?? []), membership]);
  }
  for (const resolution of resolutions) {
    if (resolution.resolution_status !== "resolved" || resolution.recipe_version_id == null) continue;
    const orderId = String(resolution.order_id);
    const versions = recipesByOrder.get(orderId) ?? new Set<string>();
    versions.add(String(resolution.recipe_version_id));
    recipesByOrder.set(orderId, versions);
  }

  const links: FiscalSaleLink[] = [];
  const unmapped: string[] = [];
  for (const document of sourceDocuments) {
    const orderId = String(document.source_order_id);
    const label = String(document.order_code);
    const orderMemberships = membershipsByOrder.get(orderId) ?? [];
    if (orderMemberships.length !== 1) {
      unmapped.push(`${label}: expected one completed production export, found ${orderMemberships.length}.`);
      continue;
    }
    const exportId = String(orderMemberships[0].export_id);
    const exportRow = completedExports.get(exportId)!;
    const warehouseId = warehouseByOrder.get(orderId);
    const warehouse = warehouseResults(exportRow.odoo_result).find((row) => Number(row.odoo_warehouse_id) === warehouseId);
    const saleOrderId = Number(warehouse?.sales_order_id);
    const recipeVersions = [...(recipesByOrder.get(orderId) ?? [])];
    const invoicePayload = document.invoice_payload as Record<string, unknown>;
    const invoiceLines = records(invoicePayload?.lines);
    const quantity = Number(invoiceLines[0]?.quantity);
    const exportWarehouse = warehousePayloads(exportRow.payload).find((row) => Number(row.odoo_warehouse_id) === warehouseId);
    const exportRecipes = records(exportWarehouse?.recipes);
    const recipeVersionId = recipeVersions.length === 1 ? recipeVersions[0] : null;
    const exportRecipe = exportRecipes.find((recipe) => String(recipe.recipe_version_id) === recipeVersionId);
    if (!Number.isInteger(warehouseId) || warehouseId! <= 0 || !Number.isInteger(saleOrderId) || saleOrderId <= 0
      || !recipeVersionId || Number(exportRecipe?.odoo_finished_product_id) !== Number(document.odoo_product_id)
      || invoiceLines.length !== 1 || !Number.isInteger(quantity) || quantity <= 0 || document.odoo_move_id == null) {
      unmapped.push(`${label}: immutable invoice or production result is incomplete.`);
      continue;
    }
    links.push({
      platform_invoice_id: String(document.id), invoice_payload_sha256: String(document.invoice_payload_sha256),
      odoo_move_id: Number(document.odoo_move_id), source_order_id: orderId, export_id: exportId,
      recipe_version_id: recipeVersionId,
      odoo_warehouse_id: warehouseId!, odoo_sale_order_id: saleOrderId,
      odoo_product_id: Number(document.odoo_product_id), quantity,
    });
  }
  links.sort((left, right) => left.platform_invoice_id.localeCompare(right.platform_invoice_id));
  const totalCandidates = links.length;
  const selectedLinks = links.slice(0, 500);
  const blockers: string[] = [];
  if (activeResult.data) blockers.push("Another fiscal invoice sales-link request is pending or processing.");
  if (pendingCount > 0 && !activeResult.data) blockers.push(`${pendingCount} invoice link${pendingCount === 1 ? " is" : "s are"} still pending a prior request result.`);
  if (documents.length > 0 && links.length === 0 && linkedCount !== documents.length) blockers.push("No posted invoices have an authoritative completed production-export mapping.");
  const payload: FiscalSaleLinkPayload | null = selectedLinks.length > 0 && blockers.length === 0
    ? { contract_version: 1, local_month: month, links: selectedLinks }
    : null;
  return {
    available: true, month, postedCount: documents.length, linkedCount, candidateCount: selectedLinks.length,
    deferredCount: Math.max(0, totalCandidates - selectedLinks.length),
    unmapped, blockers, payload, payloadSha256: payload ? sha256(payload) : null,
    latestRequest: requestFromRow(requestResult.data as Record<string, unknown> | null),
  };
}

export async function getFiscalSaleLinkAdminData(month: string): Promise<FiscalSaleLinkAdminData> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return EMPTY(month);
  try {
    return await buildFiscalSaleLinkData(await createServiceClient(), month);
  } catch (error) {
    return { ...EMPTY(month), blockers: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function enqueueFiscalSaleLinks(s: SupabaseClient, input: { month: string; requestedBy: string; expectedPayloadSha256: string }) {
  const preview = await buildFiscalSaleLinkData(s, input.month);
  if (!preview.payload || !preview.payloadSha256) throw new Error(preview.blockers[0] ?? "No fiscal invoice sales links are ready.");
  if (preview.payloadSha256 !== input.expectedPayloadSha256) throw new Error("The reconciliation preview changed. Review it again before queueing.");
  const { data, error } = await s.rpc("queue_fiscal_invoice_sale_links", {
    p_requested_by: input.requestedBy,
    p_payload: preview.payload,
    p_payload_sha256: preview.payloadSha256,
  });
  if (error) throw error;
  return data as { request_id: string; document_count: number };
}
