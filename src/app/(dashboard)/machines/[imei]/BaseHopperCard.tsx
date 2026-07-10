"use client";

import { useState, useTransition } from "react";
import { updateBaseHopper, uploadMenuItemImage } from "./actions";
import type { ProductDiyItem } from "@/lib/huaxin/client";

const input = "w-full rounded border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none";
const lbl = "mb-0.5 block text-[10px] uppercase tracking-wide text-taupe";

type BaseOption = { id: string; name: string; price: number; image_url: string | null; allergen_url: string | null };

export function BaseHopperCard({
  imei,
  machineId,
  item,
  bases,
  linkedBaseId,
}: {
  imei: string;
  machineId: string | null;
  item: ProductDiyItem | undefined;
  bases: BaseOption[];
  linkedBaseId: string | null;
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

  const save = () => {
    startTransition(async () => {
      const fields: Record<string, string> = {};
      if (name) fields.goodsName = name;
      if (price) fields.price = price;
      if (imagePath) fields.imagePath = imagePath;
      if (allergyPath) fields.allergyPath = allergyPath;

      const res = await updateBaseHopper(imei, machineId, selectedId, fields);
      if (res.ok) {
        setResult("Updated & synced.");
        setEditing(false);
      } else {
        setResult(res.error ?? "Failed");
      }
    });
  };

  return (
    <div className="rounded-xl border border-line p-3">
      {!editing ? (
        <div className="flex items-center gap-3">
          {(item?.imagePath || linkedBase?.image_url) ? (
            <img src={item?.imagePath || linkedBase?.image_url || ""} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cream text-taupe">—</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-cocoa">{item?.goodsName || linkedBase?.name || "No base set"}</div>
            <div className="text-[10px] text-taupe">
              Base · price {item?.price ?? "—"}{item?.stock ? ` · stock ${item.stock}` : ""}
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
