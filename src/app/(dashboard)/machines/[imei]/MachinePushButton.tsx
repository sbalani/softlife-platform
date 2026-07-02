"use client";

import { useActionState } from "react";
import { pushMachineProducts, type PushResult } from "./actions";

export function MachinePushButton({ imei }: { imei: string }) {
  const [res, action, pending] = useActionState<PushResult | null, FormData>(pushMachineProducts, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-4">
      <input type="hidden" name="imei" value={imei} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Pushing…" : "Push to machine"}
      </button>
      <span className="text-xs text-taupe">
        Sends each hopper&apos;s name, price, image &amp; allergen to the machine, then syncs.
      </span>
      {res && (
        <span className={`text-sm font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>
          {res.ok ? `Pushed ${res.pushed ?? ""} hopper(s).` : res.error}
        </span>
      )}
    </form>
  );
}
