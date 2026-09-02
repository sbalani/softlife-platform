"use client";

import { useActionState, type ReactNode } from "react";
import type { OdooActionResult } from "./actions";

export function OdooSaveForm({
  action, children, className,
}: {
  action: (state: OdooActionResult | null, formData: FormData) => Promise<OdooActionResult>;
  children: ReactNode;
  className?: string;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents disabled:opacity-60">{children}</fieldset>
      <span aria-live="polite" className={`text-[10px] font-semibold ${result?.ok ? "text-sage" : "text-danger"}`}>
        {pending ? "Saving..." : result?.ok ? "Saved." : result?.error ?? ""}
      </span>
    </form>
  );
}
