"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncOneMachine } from "../sync-actions";

export function MachineSyncButton({ imei, recovery = false }: { imei: string; recovery?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const sync = () => {
    startTransition(async () => {
      const res = await syncOneMachine(imei);
      setResult(res.ok
        ? res.warning ?? (recovery ? "Repair checked. Recovery is rechecking sales now." : "Machine updated.")
        : res.error ?? "Failed");
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={sync}
        disabled={pending}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-cocoa hover:bg-cream disabled:opacity-60"
      >
        {pending ? (recovery ? "Checking repair…" : "Syncing…") : recovery ? "Check repair & recover sales" : "↻ Sync machine"}
      </button>
      {result && <span className="text-[10px] text-taupe">{result}</span>}
    </div>
  );
}
