"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { generateAllergenComposite } from "@/lib/allergens/composite";

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
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

export async function createProduct(_prev: ProductResult | null, fd: FormData): Promise<ProductResult> {
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  const contains = fd.getAll("contains").map(String);
  const mayContain = fd.getAll("may_contain").map(String);
  const image = fd.get("image");
  const allergen = fd.get("allergen");

  try {
    const s = await createServiceClient();
    const imageUrl = image instanceof File && image.size ? await uploadImage(s, image) : null;
    const allergenUrl = allergen instanceof File && allergen.size ? await uploadImage(s, allergen) : null;

    const { data: inserted, error } = await s.from("products").insert({
      name,
      type: String(fd.get("type") ?? "topping"),
      sku: str(fd.get("sku")),
      description: str(fd.get("description")),
      brand: str(fd.get("brand")),
      ingredients_list: str(fd.get("ingredients_list")),
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
    }).select("id").single();
    if (error) return { ok: false, error: error.message };

    const productId = (inserted as { id: string }).id;
    const iaRows = [
      ...contains.map((aid) => ({ ingredient_id: productId, allergen_id: aid, presence: "contains" })),
      ...mayContain.map((aid) => ({ ingredient_id: productId, allergen_id: aid, presence: "may_contain" })),
    ];
    if (iaRows.length) {
      await s.from("ingredient_allergens").insert(iaRows);
    }

    // Auto-generate allergen composite image (for the machine screen / Huaxin allergyPath)
    try {
      const { data: regAllergens } = await s.from("allergens").select("id,logo_url");
      const logoById = new Map(
        ((regAllergens as { id: string; logo_url: string | null }[]) ?? []).map((a) => [a.id, a.logo_url]),
      );
      const compositeInput = [
        ...contains.map((id) => ({ logo_url: logoById.get(id) ?? null, dim: false })),
        ...mayContain.map((id) => ({ logo_url: logoById.get(id) ?? null, dim: true })),
      ].filter((a) => a.logo_url) as { logo_url: string; dim: boolean }[];
      if (compositeInput.length) {
        const buf = await generateAllergenComposite(compositeInput);
        if (buf) {
          const cpath = `allergens/composite_${productId}.png`;
          await s.storage.from("product-media").upload(cpath, buf, {
            contentType: "image/png",
            upsert: true,
          });
          const curl = s.storage.from("product-media").getPublicUrl(cpath).data.publicUrl;
          await s.from("products").update({ allergen_url: curl }).eq("id", productId);
        }
      }
    } catch (e) {
      console.error("allergen composite failed:", e);
    }

    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateProduct(_prev: ProductResult | null, fd: FormData): Promise<ProductResult> {
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  if (!id) return { ok: false, error: "Missing ingredient." };
  if (!name) return { ok: false, error: "Name is required." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  const contains = fd.getAll("contains").map(String);
  const mayContain = fd.getAll("may_contain").map(String);
  const image = fd.get("image");
  const allergen = fd.get("allergen");

  try {
    const s = await createServiceClient();
    const vals: Record<string, unknown> = {
      name,
      type: String(fd.get("type") ?? "topping"),
      sku: str(fd.get("sku")),
      description: str(fd.get("description")),
      brand: str(fd.get("brand")),
      ingredients_list: str(fd.get("ingredients_list")),
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
    };
    // Only replace the image/allergen art if a new file was actually chosen —
    // otherwise leave the existing upload alone.
    if (image instanceof File && image.size) vals.image_url = await uploadImage(s, image);
    if (allergen instanceof File && allergen.size) vals.allergen_url = await uploadImage(s, allergen);

    const { error } = await s.from("products").update(vals).eq("id", id);
    if (error) return { ok: false, error: error.message };

    await s.from("ingredient_allergens").delete().eq("ingredient_id", id);
    const iaRows = [
      ...contains.map((aid) => ({ ingredient_id: id, allergen_id: aid, presence: "contains" })),
      ...mayContain.map((aid) => ({ ingredient_id: id, allergen_id: aid, presence: "may_contain" })),
    ];
    if (iaRows.length) {
      await s.from("ingredient_allergens").insert(iaRows);
    }

    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function linkProductToOdoo(_prev: ProductResult | null, fd: FormData): Promise<ProductResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const productId = String(fd.get("product_id") ?? "");
  const odooIdRaw = String(fd.get("odoo_id") ?? "");
  if (!productId) return { ok: false, error: "Missing product." };
  const odooId = odooIdRaw ? Number(odooIdRaw) : null;

  try {
    const s = await createServiceClient();
    const { error } = await s.from("products").update({ odoo_id: odooId }).eq("id", productId);
    if (error) {
      const msg = error.code === "23505" ? "That Odoo SKU is already linked to a different ingredient." : error.message;
      return { ok: false, error: msg };
    }
    revalidatePath("/products");
    revalidatePath("/odoo");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
