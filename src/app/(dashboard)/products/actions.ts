"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ProductResult = { ok: boolean; error?: string };

export async function createProduct(
  _prev: ProductResult | null,
  fd: FormData,
): Promise<ProductResult> {
  const name = String(fd.get("name") ?? "").trim();
  const type = String(fd.get("type") ?? "topping");
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!name) return { ok: false, error: "Name is required." };
  if (!tenantId) return { ok: false, error: "Select a franchisee/tenant." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const { error } = await s.from("products").insert({ name, type, tenant_id: tenantId });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
