"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type TenantResult = { ok: boolean; error?: string };

export async function createTenant(
  _prev: TenantResult | null,
  fd: FormData,
): Promise<TenantResult> {
  const name = String(fd.get("name") ?? "").trim();
  const kind = String(fd.get("kind") ?? "franchisee");
  if (!name) return { ok: false, error: "Name is required." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  try {
    const s = await createServiceClient();
    const { error } = await s.from("tenants").insert({ name, kind });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/franchisees");
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
