"use client";

import { useState, useTransition } from "react";
import { pushComboToMachine, saveComboDraft, pushDraftItemAt, revertDraftItemAt, uploadMenuItemImage } from "./actions";
import { localizedGoodsName, languagePackEntries } from "@/lib/huaxin/client";
import type { ProductDiyItem } from "@/lib/huaxin/client";
import type { MenuDraftItem } from "@/lib/data/menu-drafts";

const input = "w-full rounded border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const lbl = "mb-0.5 block text-[10px] uppercase tracking-wide text-taupe";

export type HopperIngredientOption = { id: string; label: string; name: string; price: number };

const MIN_INGREDIENTS = 2;
const MAX_INGREDIENTS = 6;

export function ComboEditor({
  imei,
  machineId,
  item,
  hopperIngredients,
  draftId,
  draftItem,
}: {
  imei: string;
  machineId: string | null;
  item: ProductDiyItem;
  hopperIngredients: HopperIngredientOption[];
  draftId?: string | null;
  draftItem?: MenuDraftItem | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [price, setPrice] = useState(item.price ?? "");
  const [priceTouched, setPriceTouched] = useState(false);
  const [imagePath, setImagePath] = useState(item.imagePath ?? "");

  const byId = new Map(hopperIngredients.map((i) => [i.id, i]));
  const selected = selectedIds.map((id) => byId.get(id)).filter((i): i is HopperIngredientOption => !!i);
  const combinedName = selected.map((i) => i.name).join(" + ");
  const sumPrice = selected.reduce((s, i) => s + i.price, 0);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_INGREDIENTS) return prev;
      return [...prev, id];
    });
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await uploadMenuItemImage(fd);
      if (res.ok && res.url) setImagePath(res.url);
      else setResult(res.error ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const effectivePrice = priceTouched ? price : String(sumPrice || price);
  const canPush = selectedIds.length >= MIN_INGREDIENTS && selectedIds.length <= MAX_INGREDIENTS;

  const push = () => {
    startTransition(async () => {
      const res = await pushComboToMachine(imei, String(item.position ?? "0"), selectedIds, effectivePrice, imagePath);
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
      const res = await saveComboDraft(imei, machineId, String(item.position ?? "0"), selectedIds, effectivePrice, imagePath);
      setResult(res.ok ? "Saved to draft." : res.error ?? "Failed");
      if (res.ok) setEditing(false);
    });
  };

  const pushDraft = () => {
    if (!draftId) return;
    startTransition(async () => {
      const res = await pushDraftItemAt(imei, draftId, String(item.position ?? "0"));
      setResult(res.ok ? "Updated & synced." : res.error ?? "Failed");
    });
  };

  const revertDraft = () => {
    if (!draftId) return;
    startTransition(async () => {
      const res = await revertDraftItemAt(imei, draftId, String(item.position ?? "0"));
      if (!res.ok) setResult(res.error ?? "Failed");
    });
  };

  const liveEsName = localizedGoodsName(item);
  const internalName = item.goodsName;
  const locales = languagePackEntries(item);
  const displayName = draftItem ? draftItem.goodsName : liveEsName;
  const displayPrice = draftItem ? draftItem.price : item.price;
  const displayImage = draftItem ? draftItem.imagePath : item.imagePath;

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
              Combo {item.position} · price {displayPrice ?? "—"}
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
              onClick={() => {
                setEditing(true);
                setResult(null);
              }}
              className="rounded bg-cream px-2 py-1 text-[10px] font-bold text-terracotta hover:bg-sand"
            >
              ✎ Edit
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-taupe">Combo {item.position}</span>
            <button onClick={() => setEditing(false)} className="text-[10px] text-taupe hover:underline">Cancel</button>
          </div>

          <div>
            <span className={lbl}>
              Ingredients ({selectedIds.length}/{MAX_INGREDIENTS}, min {MIN_INGREDIENTS})
            </span>
            {hopperIngredients.length === 0 ? (
              <p className="text-[11px] text-taupe">No hoppers configured yet — assign ingredients above first.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {hopperIngredients.map((i) => {
                  const isSelected = selectedIds.includes(i.id);
                  const disabled = !isSelected && selectedIds.length >= MAX_INGREDIENTS;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(i.id)}
                      className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
                        isSelected
                          ? "border-terracotta bg-terracotta text-white"
                          : "border-line bg-white text-cocoa disabled:opacity-40"
                      }`}
                    >
                      {i.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={lbl}>Combined name (auto)</span>
              <input value={combinedName || "Select ingredients…"} disabled className={`${input} opacity-60`} />
            </label>
            <label className="block">
              <span className={lbl}>Price</span>
              <input
                value={effectivePrice}
                onChange={(e) => {
                  setPriceTouched(true);
                  setPrice(e.target.value);
                }}
                className={input}
              />
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
            {uploading && <span className="mt-0.5 block text-[10px] text-taupe">Uploading…</span>}
          </label>

          <p className="text-[10px] text-taupe">
            Allergen image is generated automatically from the combined ingredients on push.
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={push}
              disabled={pending || !canPush}
              className="rounded bg-terracotta px-3 py-1.5 text-[10px] font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
            >
              {pending ? "Pushing…" : "Push combo to machine"}
            </button>
            <button
              onClick={saveDraft}
              disabled={pending || !canPush}
              className="rounded border border-line bg-white px-3 py-1.5 text-[10px] font-bold text-cocoa hover:bg-cream disabled:opacity-60"
            >
              Save draft
            </button>
            {!canPush && selectedIds.length > 0 && (
              <span className="text-[10px] text-warning">Need at least {MIN_INGREDIENTS} ingredients.</span>
            )}
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
