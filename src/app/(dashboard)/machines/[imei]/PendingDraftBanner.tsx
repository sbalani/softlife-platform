"use client";

import { useState, useTransition } from "react";
import { pushMenuDraft, dismissMenuDraft } from "./actions";
import type { MenuDraft } from "@/lib/data/menu-drafts";

export function PendingDraftBanner({ imei, draft }: { imei: string; draft: MenuDraft }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const push = () => {
    startTransition(async () => {
      const res = await pushMenuDraft(imei, draft.id);
      setResult(res.ok ? `Pushed ${res.pushed ?? ""} item(s).` : res.error ?? "Failed");
    });
  };

  const dismiss = () => {
    startTransition(async () => {
      await dismissMenuDraft(imei, draft.id);
    });
  };

  return (
    <div className="mb-4 rounded-xl border border-terracotta/40 bg-terracotta/5 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <span className="text-xs font-bold uppercase text-terracotta">Pending menu draft</span>
        <span className="text-[10px] text-taupe">
          {draft.sourceMachineName ? `from ${draft.sourceMachineName} · ` : "staged edits · "}
          {new Date(draft.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {draft.items.map((it) => (
          <span key={it.position} className="rounded-full border border-line bg-white px-2 py-1 text-[10px] text-cocoa">
            #{it.position} {it.goodsName || "—"}{it.price ? ` · ${it.price}` : ""}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={push}
          disabled={pending}
          className="rounded bg-terracotta px-3 py-1.5 text-xs font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "Working…" : "Push draft to machine"}
        </button>
        <button onClick={dismiss} disabled={pending} className="text-xs text-taupe hover:underline disabled:opacity-60">
          Dismiss
        </button>
        {result && <span className="text-xs font-semibold text-sage">{result}</span>}
      </div>
    </div>
  );
}
