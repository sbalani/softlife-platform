"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissAlert } from "@/app/(dashboard)/alerts/actions";

export function DismissAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function dismiss() {
    if (!confirm("Dismiss this alert?\n\nThe latest telemetry may still report the condition. Dismissing closes this alert only; a future check can create a new alert, and machine safety locks are not overridden.")) return;
    setError(null);
    startTransition(async () => {
      const result = await dismissAlert(alertId);
      if (!result.ok) setError(result.error ?? "Could not dismiss alert.");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={dismiss} disabled={pending} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-cocoa hover:bg-cream disabled:opacity-50">
        {pending ? "Dismissing..." : "Dismiss alert"}
      </button>
      {error && <span className="text-xs font-semibold text-danger">{error}</span>}
    </div>
  );
}
