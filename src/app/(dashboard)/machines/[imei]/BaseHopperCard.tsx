"use client";

import { useState, useTransition } from "react";
import { updateBaseHopper, saveBaseDraft, pushDraftItemAt, revertDraftItemAt, uploadMenuItemImage } from "./actions";
import type { ProductDiyItem } from "@/lib/huaxin/client";
import type { MenuDraftItem } from "@/lib/data/menu-drafts";

const input = "w-full rounded border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const lbl = "mb-0.5 block text-[10px] uppercase tracking-wide text-taupe";

type BaseOption = { id: string; name: string; price: number; image_url: string | null; allergen_url: string | null };
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

  const [selectedId, setSelectedId] = useState<string | null>(linkedBaseId);
  const [name, setName] = useState(item?.goodsName ?? "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [imagePath, setImagePath] = useState(item?.imagePath ?? "");
  const [allergyPath, setAllergyPath] = useState("");

  const linkedBase = bases.find((b) => b.id === linkedBaseId) ?? null;

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

  const displayName = draftItem ? draftItem.goodsName : item?.goodsName || linkedBase?.name || "No base set";
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
              Base · price {displayPrice ?? "—"}{!draftItem && item?.stock ? ` · stock ${item.stock}` : ""}
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
              <span className={lbl}>Fill from ingredient catalog</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const b = bases.find((x) => x.id === e.target.value);
                  if (!b) return;
                  setSelectedId(b.id);
                  setName(b.name);
                  setPrice(String(b.price));
                  if (b.image_url) setImagePath(b.image_url);
                  if (b.allergen_url) setAllergyPath(b.allergen_url);
                }}
                className={input}
              >
                <option value="" disabled>Choose a base…</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
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
            <span className={lbl}>Allergen image URL</span>
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
