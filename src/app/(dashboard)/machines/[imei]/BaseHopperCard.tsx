"use client";

import { useState, useTransition } from "react";
import { pushBaseToMachine } from "./actions";
import type { ProductDiyItem } from "@/lib/huaxin/client";

type BaseProduct = { id: string; name: string; image_url: string | null };

export function BaseHopperCard({
  imei,
  item,
  baseProduct,
}: {
  imei: string;
  item: ProductDiyItem | undefined;
  baseProduct: BaseProduct | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const push = () => {
    if (!baseProduct) return;
    startTransition(async () => {
      const res = await pushBaseToMachine(imei, baseProduct.id);
      setResult(res.ok ? "Pushed." : res.error ?? "Failed");
    });
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-3">
        {baseProduct?.image_url ? (
          <img src={baseProduct.image_url} alt={baseProduct.name} referrerPolicy="no-referrer" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cream text-taupe">—</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-cocoa">{baseProduct?.name ?? "No base product set"}</div>
          <div className="text-[10px] text-taupe">
            Base · set via the &quot;Base product&quot; dropdown above{item?.price ? ` · currently on machine: price ${item.price}` : ""}
          </div>
        </div>
        <button
          onClick={push}
          disabled={pending || !baseProduct}
          className="shrink-0 rounded bg-cream px-2 py-1 text-[10px] font-bold text-terracotta hover:bg-sand disabled:opacity-50"
        >
          {pending ? "Pushing…" : "Push base"}
        </button>
      </div>
      {result && <p className={`mt-1 text-[10px] ${result === "Pushed." ? "text-sage" : "text-danger"}`}>{result}</p>}
    </div>
  );
}
