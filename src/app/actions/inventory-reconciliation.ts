"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type InventoryActionResult = { ok: boolean; error?: string; message?: string };

const UUID = /^[0-9a-f-]{36}$/i;

async function adminContext() {
  if (!isSupabaseConfigured()) throw new Error("Service is not configured.");
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") throw new Error("Administrator access is required.");
  return { actor, s: await createServiceClient() };
}

function positive(value: FormDataEntryValue | null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("Enter a positive quantity.");
  return number;
}

function movementFields(formData: FormData) {
  const clientUuid = String(formData.get("client_uuid") ?? "");
  const warehouseId = Number(formData.get("warehouse_id"));
  const lotId = Number(formData.get("odoo_lot_id"));
  const occurredAt = String(formData.get("occurred_at") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  if (!UUID.test(clientUuid) || !Number.isInteger(warehouseId) || !Number.isInteger(lotId) || !Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) > Date.now() + 5 * 60_000 || !reason) {
    throw new Error("Complete the warehouse, lot, time, and reason.");
  }
  return { clientUuid, warehouseId, lotId, occurredAt: new Date(occurredAt).toISOString(), reason };
}

function refreshInventory() {
  revalidatePath("/inventory");
  revalidatePath("/lot-audit");
  revalidatePath("/refills");
}

export async function recordReceipt(_previous: InventoryActionResult | null, formData: FormData): Promise<InventoryActionResult> {
  try {
    const { actor, s } = await adminContext();
    const values = movementFields(formData);
    const { error } = await s.rpc("record_warehouse_receipt", {
      p_client_uuid: values.clientUuid,
      p_odoo_warehouse_id: values.warehouseId,
      p_odoo_lot_id: values.lotId,
      p_quantity: positive(formData.get("quantity")),
      p_occurred_at: values.occurredAt,
      p_reason: values.reason,
      p_actor_id: actor.id,
    });
    if (error) throw error;
    refreshInventory();
    return { ok: true, message: "Receipt recorded and queued for Odoo." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function recordCorrection(_previous: InventoryActionResult | null, formData: FormData): Promise<InventoryActionResult> {
  try {
    const { actor, s } = await adminContext();
    const values = movementFields(formData);
    const quantity = Number(formData.get("quantity"));
    if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Enter a non-zero signed quantity.");
    const { error } = await s.rpc("record_warehouse_correction", {
      p_client_uuid: values.clientUuid,
      p_odoo_warehouse_id: values.warehouseId,
      p_odoo_lot_id: values.lotId,
      p_quantity: quantity,
      p_occurred_at: values.occurredAt,
      p_reason: values.reason,
      p_actor_id: actor.id,
    });
    if (error) throw error;
    refreshInventory();
    return { ok: true, message: "Correction recorded and queued for Odoo." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function recordStockTransfer(_previous: InventoryActionResult | null, formData: FormData): Promise<InventoryActionResult> {
  try {
    const { actor, s } = await adminContext();
    const values = movementFields(formData);
    const destinationId = Number(formData.get("destination_warehouse_id"));
    if (!Number.isInteger(destinationId)) throw new Error("Select a destination warehouse.");
    const { error } = await s.rpc("record_warehouse_transfer", {
      p_client_uuid: values.clientUuid,
      p_source_warehouse_id: values.warehouseId,
      p_destination_warehouse_id: destinationId,
      p_odoo_lot_id: values.lotId,
      p_quantity: positive(formData.get("quantity")),
      p_occurred_at: values.occurredAt,
      p_reason: values.reason,
      p_actor_id: actor.id,
    });
    if (error) throw error;
    refreshInventory();
    return { ok: true, message: "Transfer recorded and queued for Odoo." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function confirmAllocation(_previous: InventoryActionResult | null, formData: FormData): Promise<InventoryActionResult> {
  try {
    const { actor, s } = await adminContext();
    const clientUuid = String(formData.get("client_uuid") ?? "");
    const refillLineId = String(formData.get("refill_line_id") ?? "");
    const warehouseId = Number(formData.get("warehouse_id"));
    const lotId = Number(formData.get("odoo_lot_id"));
    if (!UUID.test(clientUuid) || !UUID.test(refillLineId) || !Number.isInteger(warehouseId) || !Number.isInteger(lotId)) throw new Error("Select a valid allocation.");
    const { error } = await s.rpc("confirm_refill_stock_allocation", {
      p_client_uuid: clientUuid,
      p_refill_line_id: refillLineId,
      p_odoo_warehouse_id: warehouseId,
      p_odoo_lot_id: lotId,
      p_physical_quantity: positive(formData.get("physical_quantity")),
      p_stock_quantity: positive(formData.get("stock_quantity")),
      p_conversion_note: String(formData.get("conversion_note") ?? "").trim().slice(0, 1000) || null,
      p_actor_id: actor.id,
    });
    if (error) throw error;
    refreshInventory();
    return { ok: true, message: "Allocation confirmed. The provenance gap and stock ledger were updated." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function voidAllocation(_previous: InventoryActionResult | null, formData: FormData): Promise<InventoryActionResult> {
  try {
    const { actor, s } = await adminContext();
    const clientUuid = String(formData.get("client_uuid") ?? "");
    const allocationId = String(formData.get("allocation_id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
    if (!UUID.test(clientUuid) || !UUID.test(allocationId) || !reason) throw new Error("A valid allocation and void reason are required.");
    const { error } = await s.rpc("void_refill_stock_allocation", { p_client_uuid: clientUuid, p_allocation_id: allocationId, p_reason: reason, p_actor_id: actor.id });
    if (error) throw error;
    refreshInventory();
    return { ok: true, message: "Allocation voided with an append-only stock reversal." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
