"use client";

import { useState, useTransition } from "react";
import { updateMachineStock } from "./actions";

export function StockControl({ imei, position, initialStock }: { imei: string; position: string; initialStock?: string | number }) {
  const [stock, setStock] = useState(initialStock == null ? "" : String(initialStock));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const isEmpty = stock === "0";

  const update = () => {
    if (!confirm(`Set position ${position} stock to ${stock}?`)) return;
    startTransition(async () => {
      const response = await updateMachineStock(imei, position, stock);
      setResult({ ok: response.ok, message: response.ok ? "Stock updated." : response.error ?? "Update failed." });
    });
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/70 pt-2">
      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${isEmpty ? "bg-danger/15 text-danger" : "bg-sage/15 text-sage"}`}>
        Stock: {stock || "unavailable"}
      </span>
      <input
        type="number"
        min="0"
        step="1"
        value={stock}
        onChange={(event) => { setStock(event.target.value); setResult(null); }}
        aria-label={`Stock for position ${position}`}
        className="w-24 rounded border border-line bg-white px-2 py-1 text-xs text-cocoa focus:border-terracotta focus:outline-none"
      />
      <button onClick={update} disabled={pending || !stock} className="rounded bg-cocoa px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">
        {pending ? "Updating..." : "Set stock"}
      </button>
      {result && <span className={`text-[10px] ${result.ok ? "text-sage" : "text-danger"}`}>{result.message}</span>}
    </div>
  );
}
