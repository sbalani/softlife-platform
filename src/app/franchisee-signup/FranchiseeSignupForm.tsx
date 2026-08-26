"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitFranchiseeSignup, type FranchiseeSignupResult } from "./actions";

const input = "mt-1 w-full rounded-xl border border-line bg-white px-4 py-3 text-base text-cocoa outline-none transition focus:border-terracotta focus:ring-2 focus:ring-terracotta/15";
const label = "block text-sm font-semibold text-cocoa";

export function FranchiseeSignupForm() {
  const [result, action, pending] = useActionState<FranchiseeSignupResult | null, FormData>(submitFranchiseeSignup, null);
  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-sage/40 bg-sage/10 p-6 text-center">
        <h2 className="font-display text-2xl font-bold text-cocoa">Request received</h2>
        <p className="mt-2 text-sm leading-6 text-taupe">SoftLife will verify your request and privately assign it to the correct franchisee account. You will receive an email setup link after approval.</p>
        <Link href="/login" className="mt-5 inline-block font-bold text-terracotta hover:underline">Return to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <div className="absolute -left-[10000px]" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className={label}>Full name *<input name="full_name" required maxLength={150} autoComplete="name" className={input} /></label>
      <label className={label}>Work email *<input name="email" type="email" required maxLength={254} autoComplete="email" className={input} /></label>
      <label className={label}>Phone number<input name="phone" maxLength={40} inputMode="tel" autoComplete="tel" placeholder="+34 600 000 000" className={input} /></label>
      <label className={label}>Company name<input name="company_name" maxLength={150} autoComplete="organization" className={input} /></label>
      <label className={label}>Additional information<textarea name="message" maxLength={1000} rows={4} placeholder="Tell us which location or SoftLife contact you work with." className={input} /></label>
      <p className="text-xs leading-5 text-taupe">No franchisee or customer names are shown on this form. SoftLife will match your request internally. See our <Link href="/privacy/en" className="font-bold text-terracotta hover:underline">privacy policy</Link>.</p>
      {result?.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{result.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-terracotta px-5 py-3.5 text-base font-bold text-white transition hover:bg-terracotta-dark disabled:opacity-60">{pending ? "Submitting..." : "Request access"}</button>
    </form>
  );
}
