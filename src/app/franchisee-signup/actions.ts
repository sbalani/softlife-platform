"use server";

import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type FranchiseeSignupResult = { ok: boolean; error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s.-]{6,40}$/;

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function submitFranchiseeSignup(
  _previous: FranchiseeSignupResult | null,
  formData: FormData,
): Promise<FranchiseeSignupResult> {
  if (field(formData, "website")) return { ok: true };
  const fullName = field(formData, "full_name");
  const email = field(formData, "email").toLowerCase();
  const phone = field(formData, "phone");
  const companyName = field(formData, "company_name");
  const message = field(formData, "message");
  if (!fullName || !email) return { ok: false, error: "Name and email are required." };
  if (fullName.length > 150 || email.length > 254 || companyName.length > 150 || message.length > 1000) return { ok: false, error: "One or more fields are too long." };
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (phone && !PHONE.test(phone)) return { ok: false, error: "Enter a valid phone number." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Registration is temporarily unavailable." };
  try {
    const { error } = await (await createServiceClient()).from("franchisee_signup_requests").insert({
      full_name: fullName,
      email,
      phone: phone || null,
      company_name: companyName || null,
      message: message || null,
    });
    if (error?.code === "23505") return { ok: true };
    return error ? { ok: false, error: "Your request could not be submitted. Please try again." } : { ok: true };
  } catch {
    return { ok: false, error: "Your request could not be submitted. Please try again." };
  }
}
