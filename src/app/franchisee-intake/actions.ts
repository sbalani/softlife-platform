"use server";

import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { bankDetailsFromForm } from "@/lib/bank-details";
import { normalizeLocale } from "@/lib/i18n/locale";

export type FranchiseeIntakeResult = { ok: boolean; error?: string };

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function submitFranchiseeIntake(
  _previous: FranchiseeIntakeResult | null,
  formData: FormData,
): Promise<FranchiseeIntakeResult> {
  if (field(formData, "website")) return { ok: true };
  const es = normalizeLocale(field(formData, "locale")) === "es";
  const tradeName = field(formData, "trade_name");
  const companyName = field(formData, "company_name");
  const contactName = field(formData, "contact_name");
  const contactEmail = field(formData, "contact_email").toLowerCase();
  const contactPhone = field(formData, "contact_phone");
  const taxId = field(formData, "tax_id");
  if (!contactName || !contactEmail || !contactPhone) return { ok: false, error: es ? "Completa el nombre, email y teléfono." : "Name, email, and phone are required." };
  if ([tradeName, companyName, contactName].some((value) => value.length > 150) || contactEmail.length > 254 || contactPhone.length > 40 || taxId.length > 50) {
    return { ok: false, error: es ? "Uno o más campos son demasiado largos." : "One or more fields are too long." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { ok: false, error: es ? "Introduce un email válido." : "Enter a valid email address." };
  if (!/^[+()\d\s.-]{6,40}$/.test(contactPhone)) return { ok: false, error: es ? "Introduce un teléfono válido." : "Enter a valid phone number." };
  const bank = bankDetailsFromForm(formData);
  if (bank.error) return { ok: false, error: bank.error };
  if (!isSupabaseConfigured()) return { ok: false, error: es ? "El formulario no está disponible temporalmente." : "The form is temporarily unavailable." };

  try {
    const s = await createServiceClient();
    const { error } = await s.from("franchisee_intake_submissions").insert({
      trade_name: tradeName || null,
      company_name: companyName || null,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      tax_id: taxId || null,
      account_holder_name: bank.details?.accountHolderName ?? null,
      iban: bank.details?.iban ?? null,
      bic_swift: bank.details?.bicSwift ?? null,
    });
    return error ? { ok: false, error: es ? "No se pudo enviar. Inténtalo de nuevo." : "The form could not be submitted. Please try again." } : { ok: true };
  } catch {
    return { ok: false, error: es ? "No se pudo enviar. Inténtalo de nuevo." : "The form could not be submitted. Please try again." };
  }
}
