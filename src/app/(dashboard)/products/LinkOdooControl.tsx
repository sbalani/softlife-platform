"use client";

import { useActionState } from "react";
import { linkProductToOdoo, type ProductResult } from "./actions";

type UnlinkedSku = { id: number; name: string; sku: string | null };

export function LinkOdooControl({
  productId,
  linkedOdooId,
  linkedSku,
  linkedQty,
  unlinkedSkus,
}: {
  productId: string;
  linkedOdooId: number | null;
  linkedSku: string | null;
  linkedQty: number | null;
  unlinkedSkus: UnlinkedSku[];
}) {
  const [res, action, pending] = useActionState<ProductResult | null, FormData>(linkProductToOdoo, null);

  if (linkedOdooId !== null) {
    return (
      <form action={action} className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <input type="hidden" name="product_id" value={productId} />
        <input type="hidden" name="odoo_id" value="" />
        <span className="text-[11px] text-sage">
          ⇄ Odoo {linkedSku ?? "—"}{linkedQty != null ? ` · ${linkedQty} on hand` : ""}
        </span>
        <button type="submit" disabled={pending} className="text-[11px] font-semibold text-taupe hover:text-danger disabled:opacity-60">
          {pending ? "…" : "Unlink"}
        </button>
      </form>
    );
  }

  if (!unlinkedSkus.length) return null;

  return (
    <form action={action} className="mt-2 flex items-center gap-2 border-t border-line pt-2">
      <input type="hidden" name="product_id" value={productId} />
      <select name="odoo_id" defaultValue="" className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-cocoa">
        <option value="" disabled>Link to Odoo SKU…</option>
        {unlinkedSkus.map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.sku ? ` (${s.sku})` : ""}</option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="shrink-0 rounded-lg bg-sand px-2 py-1 text-[11px] font-bold text-cocoa hover:bg-line disabled:opacity-60">
        {pending ? "…" : "Link"}
      </button>
      {res && !res.ok && <span className="text-[11px] text-danger">{res.error}</span>}
    </form>
  );
}
