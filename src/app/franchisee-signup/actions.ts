"use server";

import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { bankDetailsFromForm } from "@/lib/bank-details";
import { normalizeLocale } from "@/lib/i18n/locale";

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
  const es = normalizeLocale(field(formData, "locale")) === "es";
  const fullName = field(formData, "full_name");
  const email = field(formData, "email").toLowerCase();
  const phone = field(formData, "phone");
  const companyName = field(formData, "company_name");
  const taxId = field(formData, "tax_id");
  const message = field(formData, "message");
  if (!fullName || !email || !phone) return { ok: false, error: es ? "Nombre, email y teléfono son obligatorios." : "Name, email, and phone are required." };
  if (fullName.length > 150 || email.length > 254 || companyName.length > 150 || taxId.length > 50 || message.length > 1000) return { ok: false, error: es ? "Uno o más campos son demasiado largos." : "One or more fields are too long." };
  if (!EMAIL.test(email)) return { ok: false, error: es ? "Introduce un email válido." : "Enter a valid email address." };
  if (!PHONE.test(phone)) return { ok: false, error: es ? "Introduce un teléfono válido." : "Enter a valid phone number." };
  const bank = bankDetailsFromForm(formData);
  if (bank.error) return { ok: false, error: bank.error };
  if (!isSupabaseConfigured()) return { ok: false, error: es ? "El registro no está disponible temporalmente." : "Registration is temporarily unavailable." };
  try {
    const { error } = await (await createServiceClient()).from("franchisee_signup_requests").insert({
      full_name: fullName,
      email,
      phone,
      company_name: companyName || null,
      tax_id: taxId || null,
      account_holder_name: bank.details?.accountHolderName ?? null,
      iban: bank.details?.iban ?? null,
      bic_swift: bank.details?.bicSwift ?? null,
      message: message || null,
    });
    if (error?.code === "23505") return { ok: true };
    return error ? { ok: false, error: es ? "No se pudo enviar la solicitud." : "Your request could not be submitted. Please try again." } : { ok: true };
  } catch {
    return { ok: false, error: es ? "No se pudo enviar la solicitud." : "Your request could not be submitted. Please try again." };
  }
}
