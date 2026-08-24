"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";

export type ApiKeyResult = { ok: boolean; error?: string; key?: string };

async function sha256(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

const MCP_SCOPES = new Set(["read", "forms", "commands"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateApiKey(name: string, requestedScopes: string[]): Promise<ApiKeyResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };
  const actor = await getSessionProfile();
  if (!actor) return { ok: false, error: "Authentication required." };
  if (typeof name !== "string" || name.length > 100 || !Array.isArray(requestedScopes) || requestedScopes.length > 3 || requestedScopes.some((scope) => typeof scope !== "string")) return { ok: false, error: "Invalid MCP key request." };
  const trimmed = name.trim() || "Default";
  const scopes = [...new Set(requestedScopes)].filter((scope) => MCP_SCOPES.has(scope));
  if (!scopes.length || scopes.length !== new Set(requestedScopes).size) return { ok: false, error: "Select valid MCP permissions." };
  if (actor.role === "operator" && scopes.includes("commands")) return { ok: false, error: "Operators cannot create command-enabled keys." };
  try {
    const s = await createServiceClient();
    const raw = "sl_mcp_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const hash = await sha256(raw);
    const { error } = await s.from("mcp_api_keys").insert({
      name: trimmed,
      key_hash: hash,
      profile_id: actor.id,
      scopes,
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
  const actor = await getSessionProfile();
  if (!actor) return { ok: false, error: "Authentication required." };
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Invalid MCP key." };
  try {
    const s = await createServiceClient();
    let query = s.from("mcp_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (actor.role !== "admin") query = query.eq("profile_id", actor.id);
    const { error } = await query;
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
  scopes: string[];
  profile_name: string | null;
};

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  if (!isSupabaseConfigured()) return [];
  const actor = await getSessionProfile();
  if (!actor) return [];
  try {
    const s = await createServiceClient();
    let query = s.from("mcp_api_keys").select("id,name,created_at,last_used_at,revoked_at,scopes,profiles(full_name)");
    if (actor.role !== "admin") query = query.eq("profile_id", actor.id);
    const { data } = await query.order("created_at", { ascending: false });
    return ((data as unknown as (Omit<ApiKeyRow, "profile_name"> & { profiles: { full_name: string | null } | null })[]) ?? []).map((row) => ({ ...row, profile_name: row.profiles?.full_name ?? null }));
  } catch {
    return [];
  }
}
