"use client";

import { useState, useTransition } from "react";
import { syncMachineStatuses } from "./sync-actions";

export function SyncStatusesButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const sync = () => {
    startTransition(async () => {
      const res = await syncMachineStatuses();
      setResult(res.ok ? `Synced ${res.synced} machine(s).` : res.error ?? "Failed");
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={sync}
        disabled={pending}
        className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Syncing…" : "↻ Sync statuses"}
      </button>
      {result && <span className="text-xs font-semibold text-taupe">{result}</span>}
    </div>
  );
}
