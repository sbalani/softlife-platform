"use server";

import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type FranchiseeIntakeResult = { ok: boolean; error?: string };

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function submitFranchiseeIntake(
  _previous: FranchiseeIntakeResult | null,
  formData: FormData,
): Promise<FranchiseeIntakeResult> {
  if (field(formData, "website")) return { ok: true };
  const tradeName = field(formData, "trade_name");
  const companyName = field(formData, "company_name");
  const contactName = field(formData, "contact_name");
  const contactPhone = field(formData, "contact_phone");
  if (!tradeName || !companyName || !contactName || !contactPhone) return { ok: false, error: "Please complete every field." };
  if ([tradeName, companyName, contactName].some((value) => value.length > 150) || contactPhone.length > 40) {
    return { ok: false, error: "One or more fields are too long." };
  }
  if (!/^[+()\d\s.-]{6,40}$/.test(contactPhone)) return { ok: false, error: "Enter a valid contact number." };
  if (!isSupabaseConfigured()) return { ok: false, error: "The form is temporarily unavailable." };

  try {
    const s = await createServiceClient();
    const { error } = await s.from("franchisee_intake_submissions").insert({
      trade_name: tradeName,
      company_name: companyName,
      contact_name: contactName,
      contact_phone: contactPhone,
    });
    return error ? { ok: false, error: "The form could not be submitted. Please try again." } : { ok: true };
  } catch {
    return { ok: false, error: "The form could not be submitted. Please try again." };
  }
}
