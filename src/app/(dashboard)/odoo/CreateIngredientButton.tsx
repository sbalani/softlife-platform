"use client";

import { useActionState } from "react";
import { createIngredientFromOdoo, type OdooActionResult } from "./actions";

export function CreateIngredientButton({ odooId }: { odooId: number }) {
  const [res, action, pending] = useActionState<OdooActionResult | null, FormData>(createIngredientFromOdoo, null);

  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="odoo_id" value={odooId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-cocoa px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create ingredient"}
      </button>
      {res && !res.ok && <span className="text-xs text-danger">{res.error}</span>}
    </form>
  );
}
