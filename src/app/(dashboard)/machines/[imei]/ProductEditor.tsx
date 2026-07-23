"use client";

import { useState, useTransition } from "react";
import { updateMachineProduct, saveHopperDraft, pushDraftItemAt, revertDraftItemAt, uploadMenuItemImage, saveProductVariant, saveNewIngredient } from "./actions";
import { localizedGoodsName, languagePackEntries } from "@/lib/huaxin/client";
import type { ProductDiyItem } from "@/lib/huaxin/client";
import type { MenuDraftItem } from "@/lib/data/menu-drafts";

const input = "w-full rounded border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const lbl = "mb-0.5 block text-[10px] uppercase tracking-wide text-taupe";

type IngredientOption = { id: string; name: string; name_es?: string; price: number; image_url: string | null; allergen_url: string | null };

const HOPPER_LABELS: Record<string, string> = {
  "1": "Base",
  "2": "Solid Topping 1",
  "3": "Solid Topping 2",
  "4": "Solid Topping 3",
  "5": "Liquid Topping 1",
  "6": "Liquid Topping 2",
  "7": "Liquid Topping 3",
};

const HUAXIN_TO_CONFIG: Record<string, string> = {
  "2": "solid_1", "3": "solid_2", "4": "solid_3",
  "5": "liquid_1", "6": "liquid_2", "7": "liquid_3",
};

export function ProductEditor({
  imei,
  machineId,
  item,
  ingredients,
  linkedProductId,
  draftId,
  draftItem,
}: {
  imei: string;
  machineId: string | null;
  item: ProductDiyItem;
  ingredients?: IngredientOption[];
  linkedProductId?: string | null;
  draftId?: string | null;
  draftItem?: MenuDraftItem | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState<string | null>(linkedProductId ?? null);
  const [modified, setModified] = useState(false);
  const [name, setName] = useState(draftItem?.goodsName ?? localizedGoodsName(item) ?? "");
  const [price, setPrice] = useState(draftItem?.price ?? item.price ?? "");
  const [marketPrice, setMarketPrice] = useState(item.marketPrice ?? "");
  const [imagePath, setImagePath] = useState(draftItem?.imagePath ?? item.imagePath ?? "");
  const [allergyPath, setAllergyPath] = useState(draftItem?.allergyPath ?? "");

  const selectedIngredient = ingredients?.find((i) => i.id === selectedProductId) ?? null;
  const pos = String(item.position ?? "0");
  const configPos = HUAXIN_TO_CONFIG[pos];
  const productType = configPos?.startsWith("solid") ? "topping" : "sauce";

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await uploadMenuItemImage(fd);
      if (res.ok && res.url) {
        setImagePath(res.url);
        setModified(true);
      } else {
        setResult(res.error ?? "Upload failed");
      }
    } finally {
      setUploading(false);
    }
  };

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
      const res = await updateMachineProduct(imei, pos, buildFields(), {
        productId: selectedProductId,
        machineId,
      });
      if (res.ok) {
        setResult("Updated & synced.");
        setPushed(true);
        setEditing(false);
      } else {
        setResult(res.error ?? "Failed");
      }
    });
  };

  const saveDraft = () => {
    startTransition(async () => {
      const res = await saveHopperDraft(imei, machineId, pos, buildFields());
      setResult(res.ok ? "Saved to draft." : res.error ?? "Failed");
      if (res.ok) setEditing(false);
    });
  };

  const pushDraft = () => {
    if (!draftId) return;
    startTransition(async () => {
      const res = await pushDraftItemAt(imei, draftId, pos);
      setResult(res.ok ? "Updated & synced." : res.error ?? "Failed");
    });
  };

  const revertDraft = () => {
    if (!draftId) return;
    startTransition(async () => {
      const res = await revertDraftItemAt(imei, draftId, pos);
      if (!res.ok) setResult(res.error ?? "Failed");
    });
  };

  const doSaveVariant = () => {
    if (!selectedProductId) return;
    startTransition(async () => {
      const res = await saveProductVariant(selectedProductId, {
        name, price, image_url: imagePath || undefined, allergen_url: allergyPath || undefined,
      });
      setResult(res.ok ? "Ingredient updated." : res.error ?? "Failed");
      if (res.ok) { setModified(false); setPushed(false); }
    });
  };

  const doSaveNew = () => {
    startTransition(async () => {
      const res = await saveNewIngredient(
        { name, price, image_url: imagePath || undefined, allergen_url: allergyPath || undefined },
        productType, machineId, configPos,
      );
      if (res.ok && res.productId) {
        setSelectedProductId(res.productId);
        setModified(false);
        setPushed(false);
        setResult("Saved as new ingredient.");
      } else {
        setResult(res.error ?? "Failed");
      }
    });
  };

  const label = HOPPER_LABELS[pos] ?? `Hopper ${item.position}`;
  const liveEsName = localizedGoodsName(item);
  const internalName = item.goodsName;
  const locales = languagePackEntries(item);
  const displayName = draftItem ? draftItem.goodsName : liveEsName;
  const displayPrice = draftItem ? draftItem.price : item.price;
  const displayImage = draftItem ? draftItem.imagePath : item.imagePath;

  const showSaveOptions = pushed && !editing && (
    (selectedProductId && modified) || (!selectedProductId && !!name)
  );

  return (
    <div className={`rounded-xl border p-3 ${draftItem ? "border-terracotta/50 bg-terracotta/5" : "border-line"}`}>
      {!editing ? (
        <div className="flex items-center gap-3">
          {displayImage ? (
            <img src={displayImage} alt={displayName} referrerPolicy="no-referrer" className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cream text-taupe">—</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {draftItem && (
                <span className="shrink-0 rounded-full bg-terracotta px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Draft</span>
              )}
              <div className="truncate text-sm font-semibold text-cocoa">{displayName || "—"}</div>
            </div>
            <div className="text-[10px] text-taupe">
              {label} · price {displayPrice ?? "—"}
              {selectedIngredient && <span className="ml-1 text-sage">· linked: {selectedIngredient.name}</span>}
              {!selectedProductId && displayName && <span className="ml-1 text-warning">· Other</span>}
              {!draftItem && item.marketPrice ? ` · market ${item.marketPrice}` : ""}
              {!draftItem && item.stock ? ` · stock ${item.stock}` : ""}
            </div>
            {!draftItem && locales.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-taupe/60">
                {locales.map((lp) => (
                  <span key={lp.code}><span className="font-bold uppercase">{lp.code}:</span> {lp.goodsName}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {draftItem && (
              <>
                <button
                  onClick={pushDraft}
                  disabled={pending}
                  className="rounded bg-terracotta px-2 py-1 text-[10px] font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
                >
                  {pending ? "…" : "Push"}
                </button>
                <button
                  onClick={revertDraft}
                  disabled={pending}
                  className="rounded border border-line bg-white px-2 py-1 text-[10px] font-bold text-cocoa hover:bg-cream disabled:opacity-60"
                >
                  Revert
                </button>
              </>
            )}
            <button
              onClick={() => { setEditing(true); setResult(null); setPushed(false); }}
              className="rounded bg-cream px-2 py-1 text-[10px] font-bold text-terracotta hover:bg-sand"
            >
              ✎ Edit
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-taupe">{label}</span>
            <button onClick={() => setEditing(false)} className="text-[10px] text-taupe hover:underline">Cancel</button>
          </div>
          {ingredients && ingredients.length > 0 && (
            <label className="block">
              <span className={lbl}>Ingredient</span>
              <select
                value={selectedProductId ?? "other"}
                onChange={(e) => {
                  if (e.target.value === "other") {
                    setSelectedProductId(null);
                  } else {
                    const ing = ingredients.find((i) => i.id === e.target.value);
                    if (ing) {
                      setSelectedProductId(ing.id);
                      setName(ing.name);
                      setPrice(String(ing.price));
                      if (ing.image_url) setImagePath(ing.image_url);
                      if (ing.allergen_url) setAllergyPath(ing.allergen_url);
                    }
                  }
                  setModified(false);
                }}
                className={input}
              >
                <option value="other">Other (free type)</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>{i.name_es || i.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={lbl}>Name</span>
              <input value={name} onChange={(e) => { setName(e.target.value); setModified(true); }} className={input} />
            </label>
            <label className="block">
              <span className={lbl}>Price</span>
              <input value={price} onChange={(e) => { setPrice(e.target.value); setModified(true); }} className={input} />
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
              onChange={(e) => { setImagePath(e.target.value); setModified(true); }}
              className={`${input} mt-1`}
              placeholder="https://… (or upload above)"
            />
            {uploading && <span className="mt-0.5 block text-[10px] text-taupe">Uploading…</span>}
          </label>
          <label className="block">
            <span className={lbl}>Allergen image URL</span>
            <input value={allergyPath} onChange={(e) => { setAllergyPath(e.target.value); setModified(true); }} className={input} placeholder="https://…" />
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
      {showSaveOptions && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="text-[10px] text-taupe">Save to catalog:</span>
          {selectedProductId && modified && (
            <>
              <button
                onClick={doSaveVariant}
                disabled={pending}
                className="rounded bg-sage px-2 py-1 text-[10px] font-bold text-white hover:bg-sage/80 disabled:opacity-60"
              >
                {pending ? "…" : `Update "${selectedIngredient?.name ?? "ingredient"}"`}
              </button>
              <button
                onClick={doSaveNew}
                disabled={pending}
                className="rounded border border-line bg-white px-2 py-1 text-[10px] font-bold text-cocoa hover:bg-cream disabled:opacity-60"
              >
                Save as new variant
              </button>
            </>
          )}
          {!selectedProductId && (
            <button
              onClick={doSaveNew}
              disabled={pending}
              className="rounded bg-sage px-2 py-1 text-[10px] font-bold text-white hover:bg-sage/80 disabled:opacity-60"
            >
              {pending ? "…" : "Save as new ingredient"}
            </button>
          )}
        </div>
      )}
      {result && !showSaveOptions && (
        <p className={`mt-2 text-[10px] ${result.includes("Updated") || result.includes("Saved") ? "text-sage" : "text-danger"}`}>
          {result}
        </p>
      )}
    </div>
  );
}
