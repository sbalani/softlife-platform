"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";

export type UserResult = { ok: boolean; error?: string };

async function requireAdmin(): Promise<{ session: SessionProfile | null; denied: UserResult | null }> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") {
    return { session: null, denied: { ok: false, error: "Admin access required." } };
  }
  return { session, denied: null };
}

export async function createUser(_prev: UserResult | null, fd: FormData): Promise<UserResult> {
  const { denied } = await requireAdmin();
  if (denied) return denied;
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase not configured." };

  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const fullName = String(fd.get("full_name") ?? "").trim() || null;
  const role = String(fd.get("role") ?? "operator") === "admin" ? "admin" : "operator";

  if (!email) return { ok: false, error: "Email is required." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  try {
    const s = await createServiceClient();
    const { error } = await s.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteUser(userId: string): Promise<UserResult> {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;
  if (userId === session!.id) return { ok: false, error: "You can't delete your own account." };

  try {
    const s = await createServiceClient();
    const { error } = await s.auth.admin.deleteUser(userId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setUserRole(userId: string, role: "admin" | "operator"): Promise<UserResult> {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;
  if (userId === session!.id) return { ok: false, error: "You can't change your own role." };

  try {
    const s = await createServiceClient();
    const { error } = await s.from("profiles").update({ role }).eq("id", userId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
