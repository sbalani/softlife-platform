"use client";

import { useActionState } from "react";
import { pushSolidToppings, type PushResult } from "./actions";

export function PushSolidToppingsButton({ imei }: { imei: string }) {
  const [res, action, pending] = useActionState<PushResult | null, FormData>(pushSolidToppings, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="imei" value={imei} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-terracotta bg-white px-3 py-1.5 text-xs font-bold text-terracotta hover:bg-cream disabled:opacity-60"
      >
        {pending ? "Pushing…" : "Push all solid toppings"}
      </button>
      <span className="text-[11px] text-taupe">
        Recomputes the shared cross-contamination allergen image from all 3 solids and pushes together.
      </span>
      {res && (
        <span className={`text-xs font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>
          {res.ok ? `Pushed ${res.pushed ?? ""} solid(s).` : res.error}
        </span>
      )}
    </form>
  );
}
