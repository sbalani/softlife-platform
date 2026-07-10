"use client";

import { useState } from "react";
import { generateAllergenPreview } from "./actions";

const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function AllergenCompositeField({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.closest("form");
    if (!form) return;
    const contains = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="contains"]:checked')).map((el) => el.value);
    const mayContain = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="may_contain"]:checked')).map((el) => el.value);

    setPending(true);
    setError(null);
    const res = await generateAllergenPreview(contains, mayContain);
    setPending(false);
    if (res.ok && res.url) setUrl(res.url);
    else setError(res.error ?? "Failed");
  };

  return (
    <div className="col-span-2 sm:col-span-3">
      <span className={label}>Allergen image (composite)</span>
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          <img src={url} alt="Allergen composite" className="h-14 rounded-lg border border-line bg-white object-contain p-1" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-cream text-[10px] text-taupe">
            None yet
          </div>
        )}
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate allergen image"}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      <p className="mt-1 text-[10px] text-taupe">
        Built from the allergens checked above. Generate to preview before saving — if you skip this, one is still created automatically from your selections when you save.
      </p>
      <input type="hidden" name="allergen_url" value={url ?? ""} />
    </div>
  );
}
