"use client";

import { useState, useTransition } from "react";
import { addProductAlias, removeProductAlias } from "./actions";
import type { ProductAlias } from "@/lib/data/products";

export function AliasManager({ productId, aliases }: { productId: string; aliases: ProductAlias[] }) {
  const [pending, startTransition] = useTransition();
  const [newAlias, setNewAlias] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!newAlias.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addProductAlias(productId, newAlias);
      if (!res.ok) setError(res.error ?? "Failed");
      else setNewAlias("");
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      await removeProductAlias(id);
    });
  };

  return (
    <div className="mt-2">
      {aliases.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {aliases.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-[10px] text-taupe">
              {a.alias}
              <button
                onClick={() => remove(a.id)}
                disabled={pending}
                className="text-taupe/50 hover:text-danger disabled:opacity-40"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add alias (e.g. 'Soft Ice Cream')"
          disabled={pending}
          className="w-full rounded-lg border border-line bg-white px-2 py-1 text-xs text-cocoa focus:border-terracotta focus:outline-none"
        />
        <button
          onClick={add}
          disabled={pending || !newAlias.trim()}
          className="shrink-0 rounded-lg bg-terracotta px-2 py-1 text-[10px] font-bold text-white hover:bg-terracotta-dark disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-[10px] text-danger">{error}</p>}
    </div>
  );
}
