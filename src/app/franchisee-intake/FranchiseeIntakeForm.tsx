"use client";

import { useActionState } from "react";
import { submitFranchiseeIntake, type FranchiseeIntakeResult } from "./actions";

const input = "mt-1 w-full rounded-xl border border-[#d8cfc5] bg-white px-4 py-3 text-base text-[#4a3428] outline-none transition focus:border-[#c87954] focus:ring-2 focus:ring-[#c87954]/15";

export function FranchiseeIntakeForm() {
  const [result, action, pending] = useActionState<FranchiseeIntakeResult | null, FormData>(submitFranchiseeIntake, null);

  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-[#8cae93]/40 bg-[#8cae93]/10 p-6 text-center">
        <h2 className="font-display text-2xl font-bold text-[#3f6547]">Information received</h2>
        <p className="mt-2 text-sm text-[#5f6f61]">Thank you. The SoftLife team will complete the franchisee setup.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div className="absolute -left-[10000px]" aria-hidden="true">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className="block text-sm font-semibold text-[#4a3428]">
        Trade name / display name
        <input name="trade_name" required maxLength={150} autoComplete="organization" placeholder="Name customers know the business by" className={input} />
      </label>
      <label className="block text-sm font-semibold text-[#4a3428]">
        Company name
        <input name="company_name" required maxLength={150} placeholder="Registered legal company name" className={input} />
      </label>
      <label className="block text-sm font-semibold text-[#4a3428]">
        Contact person
        <input name="contact_name" required maxLength={150} autoComplete="name" placeholder="Full name" className={input} />
      </label>
      <label className="block text-sm font-semibold text-[#4a3428]">
        Contact number
        <input name="contact_phone" required maxLength={40} inputMode="tel" autoComplete="tel" placeholder="+34 600 000 000" className={input} />
      </label>
      {result?.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{result.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-[#c87954] px-5 py-3.5 text-base font-bold text-white transition hover:bg-[#ad6041] disabled:opacity-60">
        {pending ? "Submitting..." : "Submit information"}
      </button>
    </form>
  );
}
