"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function setAllergenLogo(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const file = fd.get("logo");
  if (!id || !(file instanceof File) || !file.size || !isSupabaseConfigured()) return;
  try {
    const s = await createServiceClient();
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `allergens/${id}.${ext}`;
    const { error } = await s.storage
      .from("product-media")
      .upload(path, await file.arrayBuffer(), { contentType: file.type || "image/*", upsert: true });
    if (error) return;
    const url = s.storage.from("product-media").getPublicUrl(path).data.publicUrl;
    await s.from("allergens").update({ logo_url: url }).eq("id", id);
    revalidatePath("/allergens");
    revalidatePath("/products");
  } catch {
    /* ignore */
  }
}
