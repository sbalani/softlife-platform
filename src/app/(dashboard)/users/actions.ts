"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";

export type UserResult = { ok: boolean; error?: string; message?: string };

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function logUserError(operation: string, error: unknown) {
  const details = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown } : {};
  console.error(`[users] ${operation} failed`, {
    name: details.name,
    message: details.message,
    code: details.code,
    status: details.status,
  });
}

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
  const creationMode = String(fd.get("creation_mode") ?? "password");
  const fullName = String(fd.get("full_name") ?? "").trim() || null;
  const roleValue = String(fd.get("role") ?? "operator");
  const role = roleValue === "admin" || roleValue === "franchisee" ? roleValue : "operator";
  const employerValue = String(fd.get("employer_kind") ?? "softlife");
  const employerKind = employerValue === "franchisee" || employerValue === "contractor" ? employerValue : "softlife";
  const tenantId = String(fd.get("tenant_id") ?? "") || null;

  if (!email) return { ok: false, error: "Email is required." };
  if (creationMode === "password" && password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (employerKind !== "softlife" && !tenantId) return { ok: false, error: "Employer account is required." };

  try {
    const s = await createServiceClient();
    if (tenantId) {
      const { data: tenant, error: tenantError } = await s.from("tenants").select("id,kind").eq("id", tenantId).maybeSingle();
      if (tenantError) {
        logUserError("employer lookup", tenantError);
        return { ok: false, error: errorMessage(tenantError, "Could not verify the employer account.") };
      }
      if (!tenant) return { ok: false, error: "Employer account not found." };
      if (employerKind === "franchisee" && tenant.kind !== "franchisee") return { ok: false, error: "Select a franchisee employer account." };
    }
    const metadata = { full_name: fullName, role, employer_kind: employerKind, tenant_id: tenantId };
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    const origin = requestHeaders.get("origin") ?? `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${host}`;
    const { data, error } = creationMode === "invite"
      ? await s.auth.admin.inviteUserByEmail(email, {
          data: metadata,
          redirectTo: `${origin}/auth/callback?next=/set-password`,
        })
      : await s.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata });
    if (error) {
      logUserError("Supabase Auth creation", error);
      return { ok: false, error: errorMessage(error, "Supabase could not create the user.") };
    }
    if (!data.user) return { ok: false, error: "Supabase did not return the created user." };
    const { error: profileError } = await s.from("profiles").upsert({
      id: data.user.id,
      email,
      full_name: fullName ?? email,
      role,
      employer_kind: employerKind,
      tenant_id: tenantId,
    });
    if (profileError) {
      logUserError("profile creation", profileError);
      const { error: cleanupError } = await s.auth.admin.deleteUser(data.user.id);
      if (cleanupError) logUserError("failed-user cleanup", cleanupError);
      return { ok: false, error: `The login was not kept because its profile could not be created: ${errorMessage(profileError, "unknown profile error")}` };
    }
    revalidatePath("/users");
    return { ok: true, message: creationMode === "invite" ? "Invitation sent." : "User created." };
  } catch (e) {
    logUserError("creation", e);
    return { ok: false, error: errorMessage(e, "The user could not be created.") };
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

export async function setUserAccess(userId: string, role: "admin" | "operator" | "franchisee", employerKind: "softlife" | "franchisee" | "contractor", tenantId: string | null): Promise<UserResult> {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;
  if (userId === session!.id) return { ok: false, error: "You can't change your own role." };

  try {
    const s = await createServiceClient();
    if (!new Set(["admin", "operator", "franchisee"]).has(role) || !new Set(["softlife", "franchisee", "contractor"]).has(employerKind)) return { ok: false, error: "Invalid user access." };
    if (employerKind !== "softlife" && !tenantId) return { ok: false, error: "Employer account is required." };
    const { data: current } = await s.from("profiles").select("scope_version").eq("id", userId).maybeSingle();
    if (!current) return { ok: false, error: "User not found." };
    const { error } = await s.from("profiles").update({ role, employer_kind: employerKind, tenant_id: tenantId, scope_version: Number(current.scope_version ?? 1) + 1 }).eq("id", userId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setUserMachines(userId: string, machineIds: string[]): Promise<UserResult> {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;
  if (!Array.isArray(machineIds) || machineIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return { ok: false, error: "Invalid machine selection." };
  try {
    const s = await createServiceClient();
    const { error } = await s.rpc("replace_user_machine_assignments", { p_user_id: userId, p_machine_ids: [...new Set(machineIds)], p_assigned_by: session!.id });
    if (error) throw error;
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
