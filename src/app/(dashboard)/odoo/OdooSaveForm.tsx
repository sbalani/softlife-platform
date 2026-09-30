"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { OdooActionResult } from "./actions";

export function OdooSaveForm({
  action, children, className,
}: {
  action: (state: OdooActionResult | null, formData: FormData) => Promise<OdooActionResult>;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [result, formAction, pending] = useActionState(action, null);
  useEffect(() => {
    if (result?.ok && result.redirectTo) router.replace(result.redirectTo);
  }, [result, router]);
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents disabled:opacity-60">{children}</fieldset>
      <span aria-live="polite" className={`text-[10px] font-semibold ${result?.ok ? "text-sage" : "text-danger"}`}>
        {pending ? "Saving..." : result?.ok ? result.message ?? "Saved." : result?.error ?? ""}
      </span>
    </form>
  );
}
