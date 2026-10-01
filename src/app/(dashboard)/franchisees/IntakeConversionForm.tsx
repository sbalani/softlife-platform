"use client";

import Link from "next/link";
import { useActionState } from "react";
import { convertFranchiseeIntake, type TenantResult } from "./actions";

export function IntakeConversionForm({ submissionId }: { submissionId: string }) {
  const [result, action, pending] = useActionState<TenantResult | null, FormData>(convertFranchiseeIntake, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="submission_id" value={submissionId} />
      <fieldset>
        <legend className="text-sm font-bold text-cocoa">Assign the operating modality</legend>
        <p className="mt-1 text-xs text-taupe">This creates the franchisee account. A machine and its operating dates are assigned separately when installation is scheduled.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="rounded-xl border border-line p-4 text-sm text-cocoa"><input type="radio" name="modality" value="A" required className="mr-2" /><strong>Modality A · 26%</strong><span className="mt-1 block text-xs text-taupe">The franchisee cleans and refills the machine.</span></label>
          <label className="rounded-xl border border-line p-4 text-sm text-cocoa"><input type="radio" name="modality" value="B" required className="mr-2" /><strong>Modality B · 18%</strong><span className="mt-1 block text-xs text-taupe">SoftLife cleans and refills the machine.</span></label>
        </div>
      </fieldset>
      <label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="confirmation" className="mt-0.5" /><span>I reviewed the submitted details and accepted contract and authorize creating this franchisee account with the selected modality.</span></label>
      <button disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? "Creating…" : "Create franchisee account"}</button>
      {result && !result.ok && <p className="text-sm text-danger">{result.error}</p>}
      {result?.ok && result.tenantId && <p className="text-sm font-semibold text-sage">Franchisee created. <Link href={`/franchisees/${result.tenantId}`} className="text-terracotta underline">Open the account</Link>.</p>}
    </form>
  );
}
