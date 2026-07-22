"use client";

import { useState, useTransition } from "react";
import { dismissMenuDraft } from "./actions";

export function DismissDraftButton({ imei, draftId }: { imei: string; draftId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        startTransition(async () => {
          await dismissMenuDraft(imei, draftId);
        });
      }}
      disabled={pending}
      className="rounded border border-terracotta/40 bg-white px-2 py-1 text-[10px] font-bold text-terracotta hover:bg-terracotta/5 disabled:opacity-60"
    >
      {pending ? "…" : "✕ Discard draft"}
    </button>
  );
}
