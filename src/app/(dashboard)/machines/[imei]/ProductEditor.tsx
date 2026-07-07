"use client";

import { useState, useTransition } from "react";
import { updateMachineProduct } from "./actions";
import type { ProductDiyItem } from "@/lib/huaxin/client";

const input = "w-full rounded border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const lbl = "mb-0.5 block text-[10px] uppercase tracking-wide text-taupe";

export function ProductEditor({
  imei,
  item,
  kind,
}: {
  imei: string;
  item: ProductDiyItem;
  kind: "hopper" | "menu";
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const [name, setName] = useState(item.goodsName ?? "");
  const [price, setPrice] = useState(item.price ?? "");
  const [marketPrice, setMarketPrice] = useState(item.marketPrice ?? "");
  const [imagePath, setImagePath] = useState(item.imagePath ?? "");
  const [allergyPath, setAllergyPath] = useState("");

  const save = () => {
    startTransition(async () => {
      const fields: Record<string, string> = {};
      if (name !== (item.goodsName ?? "")) fields.goodsName = name;
      if (price !== (item.price ?? "")) fields.price = price;
      if (marketPrice !== (item.marketPrice ?? "")) fields.marketPrice = marketPrice;
      if (imagePath !== (item.imagePath ?? "")) fields.imagePath = imagePath;
      if (allergyPath) fields.allergyPath = allergyPath;

      const res = await updateMachineProduct(imei, String(item.position ?? "0"), fields);
      if (res.ok) {
        setResult("Updated & synced.");
        setEditing(false);
      } else {
        setResult(res.error ?? "Failed");
      }
    });
  };

  const label = kind === "hopper" ? `Hopper ${item.position}` : `Menu ${item.position}`;

  return (
    <div className="rounded-xl border border-line p-3">
      {!editing ? (
        <div className="flex items-center gap-3">
          {item.imagePath ? (
            <img src={item.imagePath} alt={item.goodsName} className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cream text-taupe">—</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-cocoa">{item.goodsName ?? "—"}</div>
            <div className="text-[10px] text-taupe">
              {label} · price {item.price ?? "—"}{item.marketPrice ? ` · market ${item.marketPrice}` : ""}
              {item.stock ? ` · stock ${item.stock}` : ""}
            </div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 rounded bg-cream px-2 py-1 text-[10px] font-bold text-terracotta hover:bg-sand"
          >
            ✎ Edit
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-taupe">{label}</span>
            <button onClick={() => setEditing(false)} className="text-[10px] text-taupe hover:underline">Cancel</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={lbl}>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
            </label>
            <label className="block">
              <span className={lbl}>Price</span>
              <input value={price} onChange={(e) => setPrice(e.target.value)} className={input} />
            </label>
            <label className="block">
              <span className={lbl}>Market price</span>
              <input value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} className={input} />
            </label>
            <label className="block">
              <span className={lbl}>Stock</span>
              <input value={item.stock ?? ""} disabled className={`${input} opacity-50`} />
            </label>
          </div>
          <label className="block">
            <span className={lbl}>Image URL</span>
            <input value={imagePath} onChange={(e) => setImagePath(e.target.value)} className={input} placeholder="https://…" />
          </label>
          <label className="block">
            <span className={lbl}>Allergen image URL (new)</span>
            <input value={allergyPath} onChange={(e) => setAllergyPath(e.target.value)} className={input} placeholder="https://…" />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={pending}
              className="rounded bg-terracotta px-3 py-1.5 text-[10px] font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
            >
              {pending ? "Pushing…" : "Push to machine"}
            </button>
            {result && <span className={`text-[10px] ${result.includes("Updated") ? "text-sage" : "text-danger"}`}>{result}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
