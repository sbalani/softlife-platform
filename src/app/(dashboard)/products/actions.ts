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

function buildTranslations(fd: FormData): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [field, lang] of [["name_es", "es"], ["name_en", "en"], ["name_cn", "cn"]] as const) {
    const v = str(fd.get(field));
    if (v) out[lang] = v;
  }
  return Object.keys(out).length ? out : null;
}

export type ComposeResult = { ok: boolean; url?: string; error?: string };

/** Client-triggered preview: build the composite from whatever's currently
 * checked in the form (not yet saved) so the user can actually see it before
 * submitting, instead of it being generated silently on save with no way to
 * view it first. Uploads immediately so the returned URL is real and can be
 * carried through as a hidden field on submit. */
export async function generateAllergenPreview(containsIds: string[], mayContainIds: string[]): Promise<ComposeResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  if (!containsIds.length && !mayContainIds.length) return { ok: false, error: "Select at least one allergen first." };
  try {
    const s = await createServiceClient();
    const composite = await buildAllergenCompositeUrl(s, containsIds, mayContainIds, `preview_${crypto.randomUUID()}`);
    if (!composite) return { ok: false, error: "None of the selected allergens have a logo image." };
    return { ok: true, url: composite };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function buildAllergenCompositeUrl(
  s: any,
  containsIds: string[],
  mayContainIds: string[],
  cacheKey: string,
): Promise<string | null> {
  const { data: regAllergens } = await s.from("allergens").select("id,logo_url");
  const logoById = new Map(
    ((regAllergens as { id: string; logo_url: string | null }[]) ?? []).map((a) => [a.id, a.logo_url]),
  );
  const compositeInput = [
    ...containsIds.map((id) => ({ logo_url: logoById.get(id) ?? null, dim: false })),
    ...mayContainIds.map((id) => ({ logo_url: logoById.get(id) ?? null, dim: true })),
  ].filter((a) => a.logo_url) as { logo_url: string; dim: boolean }[];
  if (!compositeInput.length) return null;

  const buf = await generateAllergenComposite(compositeInput);
  if (!buf) return null;
  const path = `allergens/${cacheKey}.png`;
  const { error } = await s.storage.from("product-media").upload(path, buf, { contentType: "image/png", upsert: true });
  if (error) return null;
  return s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
}

export async function createProduct(_prev: ProductResult | null, fd: FormData): Promise<ProductResult> {
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  const contains = fd.getAll("contains").map(String);
  const mayContain = fd.getAll("may_contain").map(String);
  const image = fd.get("image");
  const allergen = fd.get("allergen");
  const explicitAllergenUrl = str(fd.get("allergen_url"));

  try {
    const s = await createServiceClient();
    const imageUrl = image instanceof File && image.size ? await uploadImage(s, image) : null;
    const uploadedAllergenUrl = allergen instanceof File && allergen.size ? await uploadImage(s, allergen) : null;

    const { data: inserted, error } = await s.from("products").insert({
      name,
      name_translations: buildTranslations(fd),
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
      allergen_url: explicitAllergenUrl ?? uploadedAllergenUrl,
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

    // Fallback only — if the user already generated a preview (or uploaded
    // one), that's already saved above and this is skipped.
    if (!explicitAllergenUrl && !uploadedAllergenUrl) {
      try {
        const curl = await buildAllergenCompositeUrl(s, contains, mayContain, `composite_${productId}`);
        if (curl) await s.from("products").update({ allergen_url: curl }).eq("id", productId);
      } catch (e) {
        console.error("allergen composite failed:", e);
      }
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
  const explicitAllergenUrl = str(fd.get("allergen_url"));

  try {
    const s = await createServiceClient();
    const vals: Record<string, unknown> = {
      name,
      name_translations: buildTranslations(fd),
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
    let allergenHandled = false;
    if (allergen instanceof File && allergen.size) {
      vals.allergen_url = await uploadImage(s, allergen);
      allergenHandled = true;
    } else if (explicitAllergenUrl) {
      vals.allergen_url = explicitAllergenUrl;
      allergenHandled = true;
    }

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

    // Fallback: allergens changed but no explicit/uploaded image this time —
    // regenerate so the composite doesn't go stale after editing allergens.
    if (!allergenHandled) {
      try {
        const curl = await buildAllergenCompositeUrl(s, contains, mayContain, `composite_${id}`);
        if (curl) await s.from("products").update({ allergen_url: curl }).eq("id", id);
      } catch (e) {
        console.error("allergen composite failed:", e);
      }
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
