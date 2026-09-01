"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { recordProductChange } from "@/lib/data/change-log";
import { cancelUnconfirmedManufacturingPeriod, confirmManufacturingPeriod, prepareManufacturingPeriod } from "@/lib/data/odoo-production";
import { inclusiveLocalDatePeriod } from "@/lib/odoo-sync-contract";

export type OdooActionResult = { ok: boolean; error?: string };

async function productionAdminClient() {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured.");
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") throw new Error("Admin access required.");
  return createServiceClient();
}

export async function saveProductionDefault(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  const consumptionType = String(fd.get("consumption_type") ?? "");
  const quantity = Number(fd.get("quantity"));
  const uom = String(fd.get("uom") ?? "").trim();
  if (!["base", "solid_topping", "liquid_topping"].includes(consumptionType) || !Number.isFinite(quantity) || quantity <= 0 || !uom) throw new Error("Invalid production default.");
  const { error } = await s.from("production_consumption_defaults").upsert({ consumption_type: consumptionType, quantity, uom });
  if (error) throw error;
  revalidatePath("/odoo");
}

export async function saveProductionProduct(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  const productId = String(fd.get("product_id") ?? "");
  const consumptionType = String(fd.get("consumption_type") ?? "") || null;
  const rawQuantity = String(fd.get("quantity") ?? "").trim();
  const uom = String(fd.get("uom") ?? "").trim() || null;
  const quantity = rawQuantity ? Number(rawQuantity) : null;
  if (!/^[0-9a-f-]{36}$/i.test(productId) || (consumptionType && !["base", "solid_topping", "liquid_topping"].includes(consumptionType)) || (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0 || !uom))) throw new Error("Invalid product consumption configuration.");
  const { error: productError } = await s.from("products").update({ consumption_type: consumptionType }).eq("id", productId);
  if (productError) throw productError;
  if (quantity === null) {
    const { error } = await s.from("production_product_consumption_overrides").delete().eq("product_id", productId);
    if (error) throw error;
  } else {
    const { error } = await s.from("production_product_consumption_overrides").upsert({ product_id: productId, quantity, uom });
    if (error) throw error;
  }
  revalidatePath("/odoo");
}

export async function saveProductionSettings(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  const rawCupOdooProductId = String(fd.get("cup_odoo_product_id") ?? "").trim();
  const cupOdooProductId = rawCupOdooProductId ? Number(rawCupOdooProductId) : null;
  const currency = String(fd.get("currency") ?? "EUR").trim().toUpperCase();
  if (cupOdooProductId !== null && (!Number.isInteger(cupOdooProductId) || cupOdooProductId <= 0) || !/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid production settings.");
  const { error } = await s.from("production_settings").update({ cup_odoo_product_id: cupOdooProductId, currency }).eq("singleton", true);
  if (error) throw error;
  revalidatePath("/odoo");
}

export async function saveWarehouseCustomer(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  const warehouseId = Number(fd.get("warehouse_id"));
  const rawCustomer = String(fd.get("customer_id") ?? "").trim();
  const customerId = rawCustomer ? Number(rawCustomer) : null;
  if (!Number.isInteger(warehouseId) || warehouseId <= 0 || customerId !== null && (!Number.isInteger(customerId) || customerId <= 0)) throw new Error("Invalid Odoo warehouse/customer mapping.");
  const { error } = await s.from("odoo_warehouses").update({ sales_customer_odoo_id: customerId }).eq("odoo_id", warehouseId);
  if (error) throw error;
  revalidatePath("/odoo");
}

export async function resolveProductionLine(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  const resolutionId = String(fd.get("resolution_id") ?? "");
  const choice = String(fd.get("choice") ?? "");
  const productId = choice.startsWith("product:") ? choice.slice(8) : null;
  const recipeId = choice.startsWith("recipe:") ? choice.slice(7) : null;
  const ignored = choice === "ignored";
  const note = String(fd.get("resolution_note") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(resolutionId)
    || (!ignored && !/^[0-9a-f-]{36}$/i.test(productId ?? "") && !/^[0-9a-f-]{36}$/i.test(recipeId ?? ""))
    || ignored && !note) throw new Error("Invalid resolution or missing ignore reason.");
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") throw new Error("Admin access required.");
  const { error } = await s.from("order_product_resolutions").update({
    platform_product_id: productId, recipe_id: recipeId, recipe_version_id: null,
    mapping_method: ignored ? "ignored" : "manual", resolution_status: ignored ? "ignored" : "resolved",
    problem_code: null, resolution_note: note || null, resolved_at: new Date().toISOString(), resolved_by: actor.id,
  }).eq("id", resolutionId).eq("resolution_status", "pending");
  if (error) throw error;
  revalidatePath("/odoo");
}

export async function preparePlatformPeriod(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  const { localFrom, localTo } = inclusiveLocalDatePeriod(String(fd.get("date_from") ?? ""), String(fd.get("date_to") ?? ""));
  const timeZone = String(fd.get("time_zone") ?? "Europe/Madrid");
  await prepareManufacturingPeriod(s, { idempotency_key: `platform:${crypto.randomUUID()}`, local_from: localFrom, local_to: localTo, time_zone: timeZone, initiated_by: "platform" }, "platform");
  revalidatePath("/odoo");
}

export async function confirmPlatformPeriod(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  if (String(fd.get("release_acknowledgement") ?? "") !== "release_frozen_payload") throw new Error("Review and acknowledge the frozen payload before release.");
  await confirmManufacturingPeriod(s, String(fd.get("export_id") ?? ""), { payload_sha256: String(fd.get("payload_sha256") ?? "") }, "platform");
  revalidatePath("/odoo");
}

export async function cancelPlatformPeriod(fd: FormData): Promise<void> {
  const s = await productionAdminClient();
  if (String(fd.get("cancel_acknowledgement") ?? "") !== "cancel_unconfirmed_preview") throw new Error("Confirm that you intend to cancel this preview.");
  await cancelUnconfirmedManufacturingPeriod(s, String(fd.get("export_id") ?? ""), "platform");
  revalidatePath("/odoo");
}

export async function createIngredientFromOdoo(
  _prev: OdooActionResult | null,
  fd: FormData,
): Promise<OdooActionResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const odooIdRaw = String(fd.get("odoo_id") ?? "");
  if (!odooIdRaw) return { ok: false, error: "Missing Odoo SKU." };
  const odooId = Number(odooIdRaw);

  try {
    const s = await productionAdminClient();
    const { data: sku, error: fetchError } = await s
      .from("odoo_products")
      .select("odoo_id,name,sku")
      .eq("odoo_id", odooId)
      .single();
    if (fetchError || !sku) return { ok: false, error: "Odoo SKU not found — try re-syncing." };

    const { data: product, error } = await s.from("products").insert({
      name: sku.name,
      sku: sku.sku,
      type: "topping",
      odoo_id: sku.odoo_id,
    }).select("*").single();
    if (error) {
      const msg = error.code === "23505" ? "That Odoo SKU is already linked to an ingredient." : error.message;
      return { ok: false, error: msg };
    }
    await recordProductChange(s, null, product as Record<string, unknown>, await getSessionProfile(), "odoo");

    revalidatePath("/odoo");
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
