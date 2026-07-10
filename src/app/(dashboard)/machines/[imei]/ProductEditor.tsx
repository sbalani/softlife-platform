"use client";

import { useState, useTransition } from "react";
import { updateMachineProduct, saveHopperDraft, uploadMenuItemImage } from "./actions";
import type { ProductDiyItem } from "@/lib/huaxin/client";

const input = "w-full rounded border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const lbl = "mb-0.5 block text-[10px] uppercase tracking-wide text-taupe";

type IngredientOption = { id: string; name: string; price: number; image_url: string | null; allergen_url: string | null };

// Matches the LANE_MAP in actions.ts — hopper 1 is the base, 2-4 solids, 5-7 liquids.
const HOPPER_LABELS: Record<string, string> = {
  "1": "Base",
  "2": "Solid Topping 1",
  "3": "Solid Topping 2",
  "4": "Solid Topping 3",
  "5": "Liquid Topping 1",
  "6": "Liquid Topping 2",
  "7": "Liquid Topping 3",
};

export function ProductEditor({
  imei,
  machineId,
  item,
  ingredients,
}: {
  imei: string;
  machineId: string | null;
  item: ProductDiyItem;
  ingredients?: IngredientOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [name, setName] = useState(item.goodsName ?? "");
  const [price, setPrice] = useState(item.price ?? "");
  const [marketPrice, setMarketPrice] = useState(item.marketPrice ?? "");
  const [imagePath, setImagePath] = useState(item.imagePath ?? "");
  const [allergyPath, setAllergyPath] = useState("");

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await uploadMenuItemImage(fd);
      if (res.ok && res.url) {
        setImagePath(res.url);
      } else {
        setResult(res.error ?? "Upload failed");
      }
    } finally {
      setUploading(false);
    }
  };

  // Always send the current form values, even if they look unchanged from
  // what we last fetched — that's exactly the case for a deliberate re-push
  // when a previous push didn't actually take on the machine.
  const buildFields = () => {
    const fields: Record<string, string> = {};
    if (name) fields.goodsName = name;
    if (price) fields.price = price;
    if (marketPrice) fields.marketPrice = marketPrice;
    if (imagePath) fields.imagePath = imagePath;
    if (allergyPath) fields.allergyPath = allergyPath;
    return fields;
  };

  const push = () => {
    startTransition(async () => {
      const res = await updateMachineProduct(imei, String(item.position ?? "0"), buildFields());
      if (res.ok) {
        setResult("Updated & synced.");
        setEditing(false);
      } else {
        setResult(res.error ?? "Failed");
      }
    });
  };

  const saveDraft = () => {
    startTransition(async () => {
      const res = await saveHopperDraft(imei, machineId, String(item.position ?? "0"), buildFields());
      setResult(res.ok ? "Saved to draft." : res.error ?? "Failed");
      if (res.ok) setEditing(false);
    });
  };

  const label = HOPPER_LABELS[String(item.position)] ?? `Hopper ${item.position}`;

  return (
    <div className="rounded-xl border border-line p-3">
      {!editing ? (
        <div className="flex items-center gap-3">
          {item.imagePath ? (
            <img src={item.imagePath} alt={item.goodsName} referrerPolicy="no-referrer" className="h-12 w-12 rounded-lg object-cover" />
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
            onClick={() => {
              setEditing(true);
              setResult(null);
            }}
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
          {ingredients && ingredients.length > 0 && (
            <label className="block">
              <span className={lbl}>Fill from ingredient catalog</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const ing = ingredients.find((i) => i.id === e.target.value);
                  if (!ing) return;
                  setName(ing.name);
                  setPrice(String(ing.price));
                  if (ing.image_url) setImagePath(ing.image_url);
                  if (ing.allergen_url) setAllergyPath(ing.allergen_url);
                }}
                className={input}
              >
                <option value="" disabled>Choose an ingredient…</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </label>
          )}
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
            <span className={lbl}>Image</span>
            <div className="flex items-center gap-2">
              {imagePath ? (
                <img src={imagePath} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded object-cover" />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-cream text-taupe">—</div>
              )}
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadImage(file);
                }}
                className={`${input} text-[10px]`}
              />
            </div>
            <input
              value={imagePath}
              onChange={(e) => setImagePath(e.target.value)}
              className={`${input} mt-1`}
              placeholder="https://… (or upload above)"
            />
            {uploading && <span className="mt-0.5 block text-[10px] text-taupe">Uploading…</span>}
          </label>
          <label className="block">
            <span className={lbl}>Allergen image URL (new)</span>
            <input value={allergyPath} onChange={(e) => setAllergyPath(e.target.value)} className={input} placeholder="https://…" />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={push}
              disabled={pending}
              className="rounded bg-terracotta px-3 py-1.5 text-[10px] font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
            >
              {pending ? "Pushing…" : "Push to machine"}
            </button>
            <button
              onClick={saveDraft}
              disabled={pending}
              className="rounded border border-line bg-white px-3 py-1.5 text-[10px] font-bold text-cocoa hover:bg-cream disabled:opacity-60"
            >
              Save draft
            </button>
          </div>
        </div>
      )}
      {result && (
        <p className={`mt-2 text-[10px] ${result.includes("Updated") || result.includes("Saved") ? "text-sage" : "text-danger"}`}>
          {result}
        </p>
      )}
    </div>
  );
}
