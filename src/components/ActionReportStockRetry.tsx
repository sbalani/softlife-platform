"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ActionReportStockRetry({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function retry() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(`/api/action-reports/${reportId}/stock-snapshot`, { method: "POST" });
      const body = await response.json() as { status?: string; error?: string };
      if (!response.ok) { setMessage(body.error ?? "Unable to capture menu stock."); return; }
      setMessage(body.status === "needs_review" ? "Captured; some product mappings need review." : "Menu stock baseline captured.");
      router.refresh();
    });
  }

  return <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-3 py-2">
    <span className="text-xs font-semibold text-warning">This confirmed refill has no menu-stock baseline.</span>
    <button type="button" onClick={retry} disabled={pending} className="rounded-lg border border-warning/40 bg-white px-2.5 py-1 text-xs font-bold text-warning disabled:opacity-50">{pending ? "Capturing..." : "Capture now"}</button>
    {message && <span className="text-xs text-taupe">{message}</span>}
  </div>;
}
