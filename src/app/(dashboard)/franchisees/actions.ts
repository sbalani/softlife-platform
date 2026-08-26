"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { FRANCHISEE_CONFIGURABLE_COMMANDS } from "@/lib/huaxin/remote-commands";

export type TenantResult = { ok: boolean; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s.-]{6,40}$/;

function optional(fd: FormData, name: string, max: number) {
  const value = String(fd.get(name) ?? "").trim();
  if (value.length > max) throw new Error(`${name.replaceAll("_", " ")} is too long.`);
  return value || null;
}

async function requireAdmin() {
  const session = await getSessionProfile();
  return session?.role === "admin" ? session : null;
}

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

export async function updateTenantDetails(_previous: TenantResult | null, fd: FormData): Promise<TenantResult> {
  if (!await requireAdmin()) return { ok: false, error: "Admin access required." };
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!UUID.test(tenantId)) return { ok: false, error: "Invalid account." };
  try {
    const values = {
      company_name: optional(fd, "company_name", 150),
      tax_id: optional(fd, "tax_id", 50),
      contact_email: optional(fd, "contact_email", 254),
      contact_phone: optional(fd, "contact_phone", 40),
      website: optional(fd, "website", 300),
      address_line_1: optional(fd, "address_line_1", 200),
      address_line_2: optional(fd, "address_line_2", 200),
      postal_code: optional(fd, "postal_code", 20),
      city: optional(fd, "city", 100),
      province: optional(fd, "province", 100),
      country: optional(fd, "country", 100),
    };
    if (values.contact_email && !EMAIL.test(values.contact_email)) return { ok: false, error: "Enter a valid company email." };
    if (values.contact_phone && !PHONE.test(values.contact_phone)) return { ok: false, error: "Enter a valid company phone number." };
    if (values.website) {
      const url = new URL(values.website);
      if (!new Set(["http:", "https:"]).has(url.protocol)) return { ok: false, error: "Website must use HTTP or HTTPS." };
    }
    const { error } = await (await createServiceClient()).from("tenants").update(values).eq("id", tenantId);
    if (error) throw error;
    revalidatePath("/franchisees");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function addTenantContact(_previous: TenantResult | null, fd: FormData): Promise<TenantResult> {
  if (!await requireAdmin()) return { ok: false, error: "Admin access required." };
  const tenantId = String(fd.get("tenant_id") ?? "");
  const fullName = String(fd.get("full_name") ?? "").trim();
  if (!UUID.test(tenantId) || !fullName || fullName.length > 150) return { ok: false, error: "Enter a valid contact name." };
  try {
    const jobTitle = optional(fd, "job_title", 150);
    const email = optional(fd, "email", 254);
    const phone = optional(fd, "phone", 40);
    if (!email && !phone) return { ok: false, error: "Add an email or phone number." };
    if (email && !EMAIL.test(email)) return { ok: false, error: "Enter a valid contact email." };
    if (phone && !PHONE.test(phone)) return { ok: false, error: "Enter a valid contact phone number." };
    const { error } = await (await createServiceClient()).from("tenant_contacts").insert({
      tenant_id: tenantId,
      full_name: fullName,
      job_title: jobTitle,
      email,
      phone,
      is_primary: fd.get("is_primary") === "yes",
    });
    if (error) throw error;
    revalidatePath("/franchisees");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeTenantContact(contactId: string): Promise<TenantResult> {
  if (!await requireAdmin()) return { ok: false, error: "Admin access required." };
  if (!UUID.test(contactId)) return { ok: false, error: "Invalid contact." };
  const { error } = await (await createServiceClient()).from("tenant_contacts").delete().eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/franchisees");
  return { ok: true };
}

export async function approveFranchiseeSignup(_previous: TenantResult | null, fd: FormData): Promise<TenantResult> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Admin access required." };
  const requestId = String(fd.get("request_id") ?? "");
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!UUID.test(requestId) || !UUID.test(tenantId)) return { ok: false, error: "Select a valid request and franchisee." };
  const s = await createServiceClient();
  const resetRequest = async () => { await s.from("franchisee_signup_requests").update({ status: "pending" }).eq("id", requestId).eq("status", "processing"); };
  try {
    const { data: tenant, error: tenantError } = await s.from("tenants").select("id").eq("id", tenantId).eq("kind", "franchisee").maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return { ok: false, error: "Franchisee account not found." };
    const { data: request, error: claimError } = await s.from("franchisee_signup_requests")
      .update({ status: "processing", reviewed_by: session.id }).eq("id", requestId).eq("status", "pending")
      .select("id,full_name,email").maybeSingle();
    if (claimError) throw claimError;
    if (!request) return { ok: false, error: "This request is already being reviewed." };

    const email = String(request.email).trim().toLowerCase();
    const { data: existingProfile, error: profileLookupError } = await s.from("profiles")
      .select("id,role,scope_version").ilike("email", email).maybeSingle();
    if (profileLookupError) throw profileLookupError;
    let userId: string;
    if (existingProfile) {
      if (existingProfile.role === "admin") {
        await resetRequest();
        return { ok: false, error: "An administrator account cannot be reassigned." };
      }
      userId = existingProfile.id;
      const { error } = await s.from("profiles").update({
        role: "franchisee",
        employer_kind: "franchisee",
        tenant_id: tenantId,
        scope_version: Number(existingProfile.scope_version ?? 1) + 1,
      }).eq("id", userId);
      if (error) throw error;
    } else {
      const requestHeaders = await headers();
      const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
      const origin = requestHeaders.get("origin") ?? `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${host}`;
      const metadata = { full_name: request.full_name, role: "franchisee", employer_kind: "franchisee", tenant_id: tenantId };
      const { data, error } = await s.auth.admin.inviteUserByEmail(email, { data: metadata, redirectTo: `${origin}/auth/callback?next=/set-password` });
      if (error || !data.user) throw error ?? new Error("The invitation did not create a user.");
      userId = data.user.id;
      const { error: profileError } = await s.from("profiles").upsert({
        id: userId,
        email,
        full_name: request.full_name,
        role: "franchisee",
        employer_kind: "franchisee",
        tenant_id: tenantId,
      });
      if (profileError) {
        await s.auth.admin.deleteUser(userId);
        throw profileError;
      }
    }
    const { error: completeError } = await s.from("franchisee_signup_requests").update({
      status: "approved",
      assigned_tenant_id: tenantId,
      approved_user_id: userId,
      reviewed_by: session.id,
      reviewed_at: new Date().toISOString(),
    }).eq("id", requestId).eq("status", "processing");
    if (completeError) throw completeError;
    revalidatePath("/franchisees");
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    await resetRequest();
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function rejectFranchiseeSignup(requestId: string): Promise<TenantResult> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Admin access required." };
  if (!UUID.test(requestId)) return { ok: false, error: "Invalid request." };
  const { error } = await (await createServiceClient()).from("franchisee_signup_requests").update({
    status: "rejected",
    reviewed_by: session.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/franchisees");
  return { ok: true };
}
