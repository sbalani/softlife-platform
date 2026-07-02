"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ProductResult = { ok: boolean; error?: string };

async function uploadImage(s: any, file: File): Promise<string | null> {
  if (!file || !file.size) return null;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `products/${crypto.randomUUID()}.${ext}`;
  const { error } = await s.storage
    .from("product-media")
    .upload(path, await file.arrayBuffer(), { contentType: file.type || "image/*", upsert: true });
  if (error) throw new Error(error.message);
  return s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
}

const str = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const splitCsv = (v: FormDataEntryValue | null) =>
  String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

export async function createProduct(_prev: ProductResult | null, fd: FormData): Promise<ProductResult> {
  const name = String(fd.get("name") ?? "").trim();
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!name) return { ok: false, error: "Name is required." };
  if (!tenantId) return { ok: false, error: "Select a franchisee/tenant." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  const image = fd.get("image");
  const allergen = fd.get("allergen");
  try {
    const s = await createServiceClient();
    const imageUrl = image instanceof File && image.size ? await uploadImage(s, image) : null;
    const allergenUrl = allergen instanceof File && allergen.size ? await uploadImage(s, allergen) : null;

    const { error } = await s.from("products").insert({
      name,
      type: String(fd.get("type") ?? "topping"),
      tenant_id: tenantId,
      sku: str(fd.get("sku")),
      description: str(fd.get("description")),
      brand: str(fd.get("brand")),
      ingredients_list: str(fd.get("ingredients_list")),
      allergens_contains: splitCsv(fd.get("allergens_contains")),
      allergens_may_contain: splitCsv(fd.get("allergens_may_contain")),
      country_of_origin: str(fd.get("country_of_origin")),
      nutritional_claim: str(fd.get("nutritional_claim")),
      nf_calories: num(fd.get("nf_calories")),
      nf_protein: num(fd.get("nf_protein")),
      nf_carbs: num(fd.get("nf_carbs")),
      nf_sugar: num(fd.get("nf_sugar")),
      nf_fat: num(fd.get("nf_fat")),
      default_portion_size: num(fd.get("default_portion_size")),
      cost_per_kg: num(fd.get("cost_per_kg")),
      price: Number(fd.get("price") ?? 0) || 0,
      image_url: imageUrl,
      allergen_url: allergenUrl,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
