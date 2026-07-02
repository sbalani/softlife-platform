"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ProductResult = { ok: boolean; error?: string };

async function uploadImage(s: ReturnType<typeof Object> & { storage: any }, file: File): Promise<string | null> {
  if (!file || !file.size) return null;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `products/${crypto.randomUUID()}.${ext}`;
  const { error } = await s.storage
    .from("product-media")
    .upload(path, await file.arrayBuffer(), { contentType: file.type || "image/*", upsert: true });
  if (error) throw new Error(error.message);
  return s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
}

export async function createProduct(
  _prev: ProductResult | null,
  fd: FormData,
): Promise<ProductResult> {
  const name = String(fd.get("name") ?? "").trim();
  const type = String(fd.get("type") ?? "topping");
  const tenantId = String(fd.get("tenant_id") ?? "");
  const price = Number(fd.get("price") ?? 0) || 0;
  const image = fd.get("image");
  const allergen = fd.get("allergen");
  if (!name) return { ok: false, error: "Name is required." };
  if (!tenantId) return { ok: false, error: "Select a franchisee/tenant." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const imageUrl = image instanceof File && image.size ? await uploadImage(s as any, image) : null;
    const allergenUrl = allergen instanceof File && allergen.size ? await uploadImage(s as any, allergen) : null;

    const { error } = await s.from("products").insert({
      name,
      type,
      tenant_id: tenantId,
      price,
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
