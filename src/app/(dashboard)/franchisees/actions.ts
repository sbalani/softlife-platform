"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { FRANCHISEE_CONFIGURABLE_COMMANDS } from "@/lib/huaxin/remote-commands";

export type TenantResult = { ok: boolean; error?: string };

export async function createTenant(
  _prev: TenantResult | null,
  fd: FormData,
): Promise<TenantResult> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, error: "Admin access required." };
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

export async function setFranchiseeRemoteCommands(tenantId: string, commands: string[]): Promise<TenantResult> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, error: "Admin access required." };
  const allowed = new Set<string>(FRANCHISEE_CONFIGURABLE_COMMANDS.map((item) => item.command));
  const selected = [...new Set(commands)];
  if (selected.some((command) => !allowed.has(command))) return { ok: false, error: "Invalid remote command." };
  const s = await createServiceClient();
  const { error } = await s.from("tenants").update({ remote_commands: selected }).eq("id", tenantId).eq("kind", "franchisee");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/franchisees");
  revalidatePath("/remote-control");
  return { ok: true };
}
