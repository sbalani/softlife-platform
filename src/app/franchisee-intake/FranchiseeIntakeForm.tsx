"use client";

import { useActionState } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { submitFranchiseeIntake, type FranchiseeIntakeResult } from "./actions";

const input = "mt-1 w-full rounded-xl border border-[#d8cfc5] bg-white px-4 py-3 text-base text-[#4a3428] outline-none transition focus:border-[#c87954] focus:ring-2 focus:ring-[#c87954]/15";

export function FranchiseeIntakeForm({ locale }: { locale: Locale }) {
  const [result, action, pending] = useActionState<FranchiseeIntakeResult | null, FormData>(submitFranchiseeIntake, null);
  const es = locale === "es";
  if (result?.ok) return <div className="rounded-2xl border border-[#8cae93]/40 bg-[#8cae93]/10 p-6 text-center"><h2 className="font-display text-2xl font-bold text-[#3f6547]">{es ? "Información recibida" : "Information received"}</h2><p className="mt-2 text-sm text-[#5f6f61]">{es ? "Gracias. El equipo de SoftLife completará la configuración." : "Thank you. The SoftLife team will complete the franchisee setup."}</p></div>;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <div className="absolute -left-[10000px]" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="block text-sm font-semibold text-[#4a3428]">{es ? "Nombre completo *" : "Full name *"}<input name="contact_name" required maxLength={150} autoComplete="name" className={input} /></label>
      <label className="block text-sm font-semibold text-[#4a3428]">Email *<input name="contact_email" type="email" required maxLength={254} autoComplete="email" className={input} /></label>
      <label className="block text-sm font-semibold text-[#4a3428]">{es ? "Teléfono *" : "Phone number *"}<input name="contact_phone" required maxLength={40} inputMode="tel" autoComplete="tel" placeholder="+34 600 000 000" className={input} /></label>
      <div className="border-t border-[#e0d6cb] pt-5"><h3 className="font-bold text-[#4a3428]">{es ? "Datos opcionales" : "Optional business and payout details"}</h3><p className="mt-1 text-xs text-[#806f63]">{es ? "Puedes completarlos ahora o más tarde desde tu cuenta." : "Complete these now or update them later from your account."}</p></div>
      <label className="block text-sm font-semibold text-[#4a3428]">{es ? "Nombre comercial" : "Trade / display name"}<input name="trade_name" maxLength={150} autoComplete="organization" className={input} /></label>
      <label className="block text-sm font-semibold text-[#4a3428]">{es ? "Empresa / autónomo" : "Company / autónomo name"}<input name="company_name" maxLength={150} className={input} /></label>
      <label className="block text-sm font-semibold text-[#4a3428]">NIF / CIF<input name="tax_id" maxLength={50} className={input} /></label>
      <label className="block text-sm font-semibold text-[#4a3428]">{es ? "Titular de la cuenta" : "Bank account holder"}<input name="account_holder_name" maxLength={150} autoComplete="name" className={input} /></label>
      <label className="block text-sm font-semibold text-[#4a3428]">IBAN<input name="iban" maxLength={34} spellCheck={false} className={`${input} font-mono uppercase`} /></label>
      <label className="block text-sm font-semibold text-[#4a3428]">BIC / SWIFT<input name="bic_swift" maxLength={11} spellCheck={false} className={`${input} font-mono uppercase`} /></label>
      {result?.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{result.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-[#c87954] px-5 py-3.5 text-base font-bold text-white transition hover:bg-[#ad6041] disabled:opacity-60">{pending ? (es ? "Enviando..." : "Submitting...") : (es ? "Enviar información" : "Submit information")}</button>
    </form>
  );
}
