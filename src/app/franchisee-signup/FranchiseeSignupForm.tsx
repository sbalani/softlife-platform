"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { submitFranchiseeSignup, type FranchiseeSignupResult } from "./actions";

const input = "mt-1 w-full rounded-xl border border-line bg-white px-4 py-3 text-base text-cocoa outline-none transition focus:border-terracotta focus:ring-2 focus:ring-terracotta/15";
const label = "block text-sm font-semibold text-cocoa";

export function FranchiseeSignupForm({ locale }: { locale: Locale }) {
  const [result, action, pending] = useActionState<FranchiseeSignupResult | null, FormData>(submitFranchiseeSignup, null);
  const es = locale === "es";
  if (result?.ok) return <div className="rounded-2xl border border-sage/40 bg-sage/10 p-6 text-center"><h2 className="font-display text-2xl font-bold text-cocoa">{es ? "Solicitud recibida" : "Request received"}</h2><p className="mt-2 text-sm leading-6 text-taupe">{es ? "SoftLife verificará tu solicitud. Recibirás por email el enlace para crear tu contraseña." : "SoftLife will verify your request. You will receive an email setup link after approval."}</p><Link href="/login" className="mt-5 inline-block font-bold text-terracotta">{es ? "Volver al acceso" : "Return to sign in"}</Link></div>;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <div className="absolute -left-[10000px]" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className={label}>{es ? "Nombre completo *" : "Full name *"}<input name="full_name" required maxLength={150} autoComplete="name" className={input} /></label>
      <label className={label}>Email *<input name="email" type="email" required maxLength={254} autoComplete="email" className={input} /></label>
      <label className={label}>{es ? "Teléfono *" : "Phone number *"}<input name="phone" required maxLength={40} inputMode="tel" autoComplete="tel" placeholder="+34 600 000 000" className={input} /></label>
      <div className="border-t border-line pt-5"><h3 className="font-bold text-cocoa">{es ? "Datos opcionales" : "Optional business and payout details"}</h3><p className="mt-1 text-xs text-taupe">{es ? "Puedes actualizarlos más tarde desde tu cuenta." : "You can update these later from your account."}</p></div>
      <label className={label}>{es ? "Empresa / autónomo" : "Company / autónomo name"}<input name="company_name" maxLength={150} autoComplete="organization" className={input} /></label>
      <label className={label}>NIF / CIF<input name="tax_id" maxLength={50} className={input} /></label>
      <label className={label}>{es ? "Titular de la cuenta" : "Bank account holder"}<input name="account_holder_name" maxLength={150} className={input} /></label>
      <label className={label}>IBAN<input name="iban" maxLength={34} spellCheck={false} className={`${input} font-mono uppercase`} /></label>
      <label className={label}>BIC / SWIFT<input name="bic_swift" maxLength={11} spellCheck={false} className={`${input} font-mono uppercase`} /></label>
      <label className={label}>{es ? "Información adicional" : "Additional information"}<textarea name="message" maxLength={1000} rows={4} className={input} /></label>
      <p className="text-xs leading-5 text-taupe">{es ? "SoftLife asignará tu solicitud de forma privada. Consulta nuestra " : "SoftLife will privately assign your request. See our "}<Link href={es ? "/privacy" : "/privacy/en"} className="font-bold text-terracotta">{es ? "política de privacidad" : "privacy policy"}</Link>.</p>
      {result?.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{result.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-terracotta px-5 py-3.5 text-base font-bold text-white disabled:opacity-60">{pending ? (es ? "Enviando..." : "Submitting...") : (es ? "Solicitar acceso" : "Request access")}</button>
    </form>
  );
}
