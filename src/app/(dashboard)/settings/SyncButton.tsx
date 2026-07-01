"use client";

import { useActionState } from "react";
import { sync, type SyncResult } from "./actions";

export function SyncButton() {
  const [result, action, pending] = useActionState<SyncResult | null, FormData>(sync, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-4">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white transition hover:bg-terracotta-dark disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {result && (
        <span className={`text-sm font-semibold ${result.ok ? "text-sage" : "text-danger"}`}>
          {result.summary}
        </span>
      )}
    </form>
  );
}
