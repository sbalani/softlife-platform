"use client";

import { useActionState } from "react";
import { uploadMedia, type UploadResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function MediaUploader() {
  const [res, action, pending] = useActionState<UploadResult | null, FormData>(uploadMedia, null);
  return (
    <form action={action} encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className={label}>File</span>
        <input name="file" type="file" accept="image/*,video/*" className={`text-xs ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Name</span>
        <input name="name" placeholder="Summer promo" className={`w-40 ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Type</span>
        <select name="type" className={input}>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </label>
      <label className="block">
        <span className={label}>Duration (s)</span>
        <input name="duration" type="number" defaultValue="60" className={`w-20 ${input}`} />
      </label>
      <button type="submit" disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">
        {pending ? "Uploading…" : "Upload"}
      </button>
      {res && <span className={`text-xs font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>{res.ok ? "Uploaded." : res.error}</span>}
    </form>
  );
}
