"use client";

import type { MouseEvent } from "react";

export function DraftInvoiceSelectionControls({ count }: { count: number }) {
  function setAll(event: MouseEvent<HTMLButtonElement>, checked: boolean) {
    event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="document_id"]')
      .forEach((input) => { input.checked = checked; });
  }

  return <div className="flex flex-wrap items-center gap-3">
    <button type="button" onClick={(event) => setAll(event, true)} className="text-xs font-bold text-terracotta">Select all ({count})</button>
    <button type="button" onClick={(event) => setAll(event, false)} className="text-xs font-semibold text-taupe">Clear selection</button>
  </div>;
}
