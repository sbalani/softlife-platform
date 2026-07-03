"use client";

import { useTransition } from "react";

type Ingredient = { position: string; product_id: string | null; product_name: string | null; product_type: string };

export function LogLotForm({
  machineId,
  imei,
  machineName,
  ingredients,
}: {
  machineId: string;
  imei: string;
  machineName: string;
  ingredients: Ingredient[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        startTransition(async () => {
          await fetch("/api/log-lot", { method: "POST", body: fd });
          window.location.reload();
        });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="machine_id" value={machineId} />
      <input type="hidden" name="imei" value={imei} />
      <input type="hidden" name="machine_name" value={machineName} />
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Hopper</span>
        <select name="ingredient" className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa">
          {ingredients.map((ing) => (
            <option key={ing.position} value={JSON.stringify(ing)}>
              {ing.position} — {ing.product_name ?? "—"}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Lot name *</span>
        <input name="lot_name" required placeholder="LOT-2026-0703" className="w-40 rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Quantity</span>
        <input name="quantity" type="number" step="0.1" placeholder="0" className="w-24 rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
      >
        {pending ? "Logging…" : "Log lot"}
      </button>
    </form>
  );
}
