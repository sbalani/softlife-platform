"use client";

import { useState, useTransition } from "react";
import { pushMenuDraft, dismissMenuDraft } from "./actions";

export function DraftBulkActions({ imei, draftId, count }: { imei: string; draftId: string; count: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const pushAll = () => {
    startTransition(async () => {
      const res = await pushMenuDraft(imei, draftId);
      setResult(res.ok ? `Pushed ${res.pushed ?? ""} item(s).` : res.error ?? "Failed");
    });
  };

  const discardAll = () => {
    startTransition(async () => {
      await dismissMenuDraft(imei, draftId);
    });
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-semibold text-terracotta">{count} staged</span>
      <button onClick={pushAll} disabled={pending} className="font-semibold text-terracotta hover:underline disabled:opacity-60">
        Push all
      </button>
      <span className="text-line">·</span>
      <button onClick={discardAll} disabled={pending} className="font-semibold text-taupe hover:underline disabled:opacity-60">
        Discard all
      </button>
      {result && <span className="text-sage">{result}</span>}
    </div>
  );
}
