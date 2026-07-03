"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { addDeviceMedia, removeDeviceMediaAction, type MediaResult } from "./actions";

type MediaItem = { code?: string; imagePath?: string; duration?: number; intro?: string };

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function MediaManager({ imei, media }: { imei: string; media: MediaItem[] }) {
  const [addRes, addAction, addPending] = useActionState<MediaResult | null, FormData>(addDeviceMedia, null);
  const [rmPending, startRm] = useTransition();
  const [rmMsg, setRmMsg] = useState<string | null>(null);

  const remove = (resType: string, resCode: string) => {
    startRm(async () => {
      const res = await removeDeviceMediaAction(imei, resType, resCode);
      setRmMsg(res.ok ? "Removed." : res.error ?? "Failed");
    });
  };

  return (
    <div className="space-y-4">
      <form action={addAction} encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="imei" value={imei} />
        <label className="block">
          <span className={label}>Media file</span>
          <input name="media" type="file" accept="image/*,video/*" className={`text-xs ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Type</span>
          <select name="res_type" className={input}>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>Duration (s)</span>
          <input name="res_duration" type="number" defaultValue="60" className={`w-20 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Description</span>
          <input name="res_intro" type="text" placeholder="Summer promo" className={`w-40 ${input}`} />
        </label>
        <button
          type="submit"
          disabled={addPending || rmPending}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {addPending ? "Pushing…" : "Add & push"}
        </button>
        {addRes && (
          <span className={`text-xs font-semibold ${addRes.ok ? "text-sage" : "text-danger"}`}>
            {addRes.ok ? "Pushed to machine." : addRes.error}
          </span>
        )}
      </form>

      {media.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {media.map((m, i) => (
            <div key={m.code ?? i} className="rounded-xl border border-line p-2 text-center">
              {m.imagePath ? (
                <img src={m.imagePath} alt={m.intro ?? `Media ${m.code}`} className="h-20 w-32 rounded-lg object-cover" />
              ) : (
                <div className="flex h-20 w-32 items-center justify-center rounded-lg bg-cream text-taupe">—</div>
              )}
              <div className="mt-1 text-[10px] text-taupe">
                {m.intro ?? m.code} {m.duration ? `· ${m.duration}s` : ""}
              </div>
              {m.code && (
                <button
                  onClick={() => remove("image", m.code)}
                  disabled={rmPending}
                  className="mt-1 text-[10px] font-bold text-danger hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {rmMsg && <p className="text-xs text-taupe">{rmMsg}</p>}
    </div>
  );
}
