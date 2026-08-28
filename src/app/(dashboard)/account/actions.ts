"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { bankDetailsFromForm } from "@/lib/bank-details";
import { createServiceClient } from "@/lib/supabase/server";

export type AccountResult = { ok: boolean; error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s.-]{6,40}$/;

function optional(formData: FormData, name: string, max: number) {
  const value = String(formData.get(name) ?? "").trim();
  if (value.length > max) throw new Error(`${name.replaceAll("_", " ")} is too long.`);
  return value || null;
}

async function ownFranchisee() {
  const session = await getSessionProfile();
  return session?.role === "franchisee" && session.tenant_id ? session : null;
}

function revalidateAccount() {
  revalidatePath("/account");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
  revalidatePath("/", "layout");
}

export async function saveOwnCompanyDetails(_previous: AccountResult | null, formData: FormData): Promise<AccountResult> {
  const session = await ownFranchisee();
  if (!session) return { ok: false, error: "Franchisee access required." };
  try {
    const values = {
      company_name: optional(formData, "company_name", 150),
      tax_id: optional(formData, "tax_id", 50),
      contact_email: optional(formData, "contact_email", 254),
      contact_phone: optional(formData, "contact_phone", 40),
      website: optional(formData, "website", 300),
      address_line_1: optional(formData, "address_line_1", 200),
      address_line_2: optional(formData, "address_line_2", 200),
      postal_code: optional(formData, "postal_code", 20),
      city: optional(formData, "city", 100),
      province: optional(formData, "province", 100),
      country: optional(formData, "country", 100),
    };
    if (values.contact_email && !EMAIL.test(values.contact_email)) return { ok: false, error: "Enter a valid email." };
    if (values.contact_phone && !PHONE.test(values.contact_phone)) return { ok: false, error: "Enter a valid phone number." };
    if (values.website) {
      const url = new URL(values.website);
      if (!new Set(["http:", "https:"]).has(url.protocol)) return { ok: false, error: "Website must use HTTP or HTTPS." };
    }
    const { data, error } = await (await createServiceClient()).from("tenants").update(values)
      .eq("id", session.tenant_id).eq("kind", "franchisee").select("id").maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Franchisee account not found." };
    revalidateAccount();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save company details." };
  }
}

export async function saveOwnBankDetails(_previous: AccountResult | null, formData: FormData): Promise<AccountResult> {
  const session = await ownFranchisee();
  if (!session) return { ok: false, error: "Franchisee access required." };
  const parsed = bankDetailsFromForm(formData);
  if (parsed.error || !parsed.details) return { ok: false, error: parsed.error ?? "Enter the bank details." };
  const { details } = parsed;
  const { error } = await (await createServiceClient()).from("tenant_bank_details").upsert({
    tenant_id: session.tenant_id,
    account_holder_name: details.accountHolderName,
    iban: details.iban,
    bic_swift: details.bicSwift,
    bank_name: details.bankName,
    updated_at: new Date().toISOString(),
    updated_by: session.id,
  });
  if (error) return { ok: false, error: "Could not save bank details." };
  revalidateAccount();
  return { ok: true };
}
