"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type OdooActionResult = { ok: boolean; error?: string };

export async function createIngredientFromOdoo(
  _prev: OdooActionResult | null,
  fd: FormData,
): Promise<OdooActionResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const odooIdRaw = String(fd.get("odoo_id") ?? "");
  if (!odooIdRaw) return { ok: false, error: "Missing Odoo SKU." };
  const odooId = Number(odooIdRaw);

  try {
    const s = await createServiceClient();
    const { data: sku, error: fetchError } = await s
      .from("odoo_products")
      .select("odoo_id,name,sku")
      .eq("odoo_id", odooId)
      .single();
    if (fetchError || !sku) return { ok: false, error: "Odoo SKU not found — try re-syncing." };

    const { error } = await s.from("products").insert({
      name: sku.name,
      sku: sku.sku,
      type: "topping",
      odoo_id: sku.odoo_id,
    });
    if (error) {
      const msg = error.code === "23505" ? "That Odoo SKU is already linked to an ingredient." : error.message;
      return { ok: false, error: msg };
    }

    revalidatePath("/odoo");
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
