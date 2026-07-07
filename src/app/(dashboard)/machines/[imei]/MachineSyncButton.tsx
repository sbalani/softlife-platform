"use client";

import { useState, useTransition } from "react";
import { syncOneMachine } from "../sync-actions";

export function MachineSyncButton({ imei }: { imei: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const sync = () => {
    startTransition(async () => {
      const res = await syncOneMachine(imei);
      setResult(res.ok ? "Status updated." : res.error ?? "Failed");
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={sync}
        disabled={pending}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-cocoa hover:bg-cream disabled:opacity-60"
      >
        {pending ? "Syncing…" : "↻ Sync status"}
      </button>
      {result && <span className="text-[10px] text-taupe">{result}</span>}
    </div>
  );
}
