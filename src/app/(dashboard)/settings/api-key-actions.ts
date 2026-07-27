"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ApiKeyResult = { ok: boolean; error?: string; key?: string };

async function sha256(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

export async function generateApiKey(name: string, profileId?: string): Promise<ApiKeyResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const trimmed = name.trim() || "Default";
  try {
    const s = await createServiceClient();
    const raw = "sl_mcp_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const hash = await sha256(raw);
    const { error } = await s.from("mcp_api_keys").insert({
      name: trimmed,
      key_hash: hash,
      profile_id: profileId ?? null,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true, key: raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function revokeApiKey(id: string): Promise<ApiKeyResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  try {
    const s = await createServiceClient();
    const { error } = await s.from("mcp_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ApiKeyRow = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s.from("mcp_api_keys").select("id,name,created_at,last_used_at,revoked_at").order("created_at", { ascending: false });
    return (data as ApiKeyRow[]) ?? [];
  } catch {
    return [];
  }
}
