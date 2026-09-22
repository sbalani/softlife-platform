"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type SalesNoteActionResult = { ok: boolean; error?: string; message?: string; resetKey?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(["event", "promotion", "operations", "competition", "other"]);

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function createSalesContextNote(_previous: SalesNoteActionResult, formData: FormData): Promise<SalesNoteActionResult> {
  const actor = await getSessionProfile();
  if (!actor || !["admin", "franchisee"].includes(actor.role)) return { ok: false, error: "Sales note access denied." };
  const salesDate = String(formData.get("sales_date") ?? "");
  const category = String(formData.get("category") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const machineValue = String(formData.get("machine_id") ?? "");
  const machineId = machineValue && UUID.test(machineValue) ? machineValue : null;
  const sourceValue = String(formData.get("source_url") ?? "").trim();
  let sourceUrl: string | null = null;
  if (sourceValue) {
    try {
      const parsed = new URL(sourceValue);
      if (parsed.protocol !== "https:" || sourceValue.length > 1000) throw new Error();
      sourceUrl = parsed.toString();
    } catch {
      return { ok: false, error: "Source URL must be a valid HTTPS address." };
    }
  }
  if (!validDay(salesDate) || !CATEGORIES.has(category) || !body || body.length > 2000 || (machineValue && !machineId)) return { ok: false, error: "Complete the sales note with valid details." };
  const { error } = await (await createServiceClient()).rpc("create_sales_context_note", {
    p_actor_id: actor.id, p_client_uuid: crypto.randomUUID(), p_sales_date: salesDate, p_category: category,
    p_body: body, p_source_url: sourceUrl, p_machine_id: machineId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/analytics");
  return { ok: true, message: "Event or sales context added.", resetKey: crypto.randomUUID() };
}

export async function deleteSalesContextNote(noteId: string, expectedRevision: number): Promise<SalesNoteActionResult> {
  const actor = await getSessionProfile();
  if (!actor || !["admin", "franchisee"].includes(actor.role) || !UUID.test(noteId) || !Number.isInteger(expectedRevision) || expectedRevision < 1) return { ok: false, error: "Sales note access denied." };
  const { error } = await (await createServiceClient()).rpc("delete_sales_context_note", {
    p_actor_id: actor.id, p_note_id: noteId, p_expected_revision: expectedRevision, p_confirm: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/analytics");
  return { ok: true, message: "Sales context note removed." };
}
