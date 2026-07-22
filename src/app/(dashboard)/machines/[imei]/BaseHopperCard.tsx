"use client";

import { useState, useTransition } from "react";
import { updateBaseHopper, saveBaseDraft, pushDraftItemAt, revertDraftItemAt, uploadMenuItemImage, saveProductVariant, saveNewIngredient } from "./actions";
import { localizedGoodsName } from "@/lib/huaxin/client";
import type { ProductDiyItem } from "@/lib/huaxin/client";
import type { MenuDraftItem } from "@/lib/data/menu-drafts";

const input = "w-full rounded border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const lbl = "mb-0.5 block text-[10px] uppercase tracking-wide text-taupe";

type BaseOption = { id: string; name: string; name_es?: string; price: number; image_url: string | null; allergen_url: string | null };
const BASE_POSITION = "1";

export function BaseHopperCard({
  imei,
  machineId,
  item,
  bases,
  linkedBaseId,
  draftId,
  draftItem,
}: {
  imei: string;
  machineId: string | null;
  item: ProductDiyItem | undefined;
  bases: BaseOption[];
  linkedBaseId: string | null;
  draftId?: string | null;
  draftItem?: MenuDraftItem | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);
  const [modified, setModified] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(linkedBaseId);
  const [name, setName] = useState(item ? (draftItem?.goodsName ?? localizedGoodsName(item)) ?? "" : "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [imagePath, setImagePath] = useState(item?.imagePath ?? "");
  const [allergyPath, setAllergyPath] = useState("");

  const linkedBase = bases.find((b) => b.id === linkedBaseId) ?? null;
  const selectedBase = bases.find((b) => b.id === selectedId) ?? null;

  const doSaveVariant = () => {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await saveProductVariant(selectedId, {
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
        "base", machineId, undefined,
      );
      if (res.ok && res.productId) {
        setSelectedId(res.productId);
        setModified(false);
        setPushed(false);
        setResult("Saved as new ingredient.");
      } else {
        setResult(res.error ?? "Failed");
      }
    });
  };

  const showSaveOptions = pushed && !editing && (
    (selectedId && modified) || (!selectedId && !!name)
  );

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await uploadMenuItemImage(fd);
      if (res.ok && res.url) { setImagePath(res.url); setModified(true); }
      else setResult(res.error ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const buildFields = () => {
    const fields: Record<string, string> = {};
    if (name) fields.goodsName = name;
    if (price) fields.price = price;
    if (imagePath) fields.imagePath = imagePath;
    if (allergyPath) fields.allergyPath = allergyPath;
    return fields;
  };

  const push = () => {
    startTransition(async () => {
      const res = await updateBaseHopper(imei, machineId, selectedId, buildFields());
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
      const res = await saveBaseDraft(imei, machineId, selectedId, buildFields());
      setResult(res.ok ? "Saved to draft." : res.error ?? "Failed");
      if (res.ok) setEditing(false);
    });
  };

  const pushDraft = () => {
    if (!draftId) return;
    startTransition(async () => {
      const res = await pushDraftItemAt(imei, draftId, BASE_POSITION);
      setResult(res.ok ? "Updated & synced." : res.error ?? "Failed");
    });
  };

  const revertDraft = () => {
    if (!draftId) return;
    startTransition(async () => {
      const res = await revertDraftItemAt(imei, draftId, BASE_POSITION);
      if (!res.ok) setResult(res.error ?? "Failed");
    });
  };

  const liveEsName = item ? localizedGoodsName(item) : "";
  const internalName = item?.goodsName;
  const displayName = draftItem ? draftItem.goodsName : liveEsName || linkedBase?.name || "No base set";
  const displayPrice = draftItem ? draftItem.price : item?.price;
  const displayImage = draftItem ? draftItem.imagePath : item?.imagePath || linkedBase?.image_url;

  return (
    <div className={`rounded-xl border p-3 ${draftItem ? "border-terracotta/50 bg-terracotta/5" : "border-line"}`}>
      {!editing ? (
        <div className="flex items-center gap-3">
          {displayImage ? (
            <img src={displayImage} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cream text-taupe">—</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {draftItem && (
                <span className="shrink-0 rounded-full bg-terracotta px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Draft</span>
              )}
              <div className="truncate text-sm font-semibold text-cocoa">{displayName}</div>
            </div>
            <div className="text-[10px] text-taupe">
              Base · price {displayPrice ?? "—"}
              {!draftItem && internalName && internalName !== liveEsName && <span className="ml-1 text-taupe/60">· int: {internalName}</span>}
              {selectedBase && <span className="ml-1 text-sage">· linked: {selectedBase.name}</span>}
              {!selectedId && displayName && displayName !== "No base set" && <span className="ml-1 text-warning">· Other</span>}
              {!draftItem && item?.stock ? ` · stock ${item.stock}` : ""}
            </div>
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
            <span className="text-[10px] font-bold uppercase text-taupe">Base</span>
            <button onClick={() => setEditing(false)} className="text-[10px] text-taupe hover:underline">Cancel</button>
          </div>
          {bases.length > 0 && (
            <label className="block">
              <span className={lbl}>Ingredient</span>
              <select
                value={selectedId ?? "other"}
                onChange={(e) => {
                  if (e.target.value === "other") {
                    setSelectedId(null);
                  } else {
                    const b = bases.find((x) => x.id === e.target.value);
                    if (b) {
                      setSelectedId(b.id);
                      setName(b.name);
                      setPrice(String(b.price));
                      if (b.image_url) setImagePath(b.image_url);
                      if (b.allergen_url) setAllergyPath(b.allergen_url);
                    }
                  }
                  setModified(false);
                }}
                className={input}
              >
                <option value="other">Other (free type)</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>{b.name_es || b.name}</option>
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
          {selectedId && modified && (
            <>
              <button
                onClick={doSaveVariant}
                disabled={pending}
                className="rounded bg-sage px-2 py-1 text-[10px] font-bold text-white hover:bg-sage/80 disabled:opacity-60"
              >
                {pending ? "…" : `Update "${selectedBase?.name ?? "base"}"`}
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
          {!selectedId && (
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
