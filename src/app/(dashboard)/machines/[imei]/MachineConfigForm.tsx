"use client";

import { useState } from "react";
import { useActionState } from "react";
import { saveMachineConfig, type SaveResult } from "./actions";
import type { MachineConfig } from "@/lib/data/machine-config";

export function MachineConfigForm({ config, imei }: { config: MachineConfig; imei: string }) {
  const [profile, setProfile] = useState(config.profile ?? "");
  const [res, action, pending] = useActionState<SaveResult | null, FormData>(saveMachineConfig, null);

  const ing = (pos: string) => config.ingredients.find((i) => i.position === pos)?.product_id ?? "";
  const lastCleanDate = config.lastFullClean ? config.lastFullClean.slice(0, 10) : "";
  const slots = profile === "3+3" ? 3 : 0;

  const selectClass =
    "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
  const labelClass = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="machine_id" value={config.machineId ?? ""} />
      <input type="hidden" name="imei" value={imei} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Base product</span>
          <select name="base_product_id" defaultValue={config.baseProductId ?? ""} className={selectClass}>
            <option value="">—</option>
            {config.bases.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Profile</span>
          <select
            name="profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className={selectClass}
          >
            <option value="">—</option>
            <option value="3+3">3+3 (3 solid + 3 liquid)</option>
            <option value="manual">Manual (no dispensers)</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Last full clean</span>
          <input type="date" name="last_full_clean" defaultValue={lastCleanDate} className={selectClass} />
        </label>
      </div>

      {slots > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: slots }).map((_, i) => (
            <label key={`solid_${i + 1}`} className="block">
              <span className={labelClass}>Solid {i + 1} (topping)</span>
              <select name={`solid_${i + 1}`} defaultValue={ing(`solid_${i + 1}`)} className={selectClass}>
                <option value="">—</option>
                {config.toppings.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          ))}
          {Array.from({ length: slots }).map((_, i) => (
            <label key={`liquid_${i + 1}`} className="block">
              <span className={labelClass}>Liquid {i + 1} (sauce)</span>
              <select name={`liquid_${i + 1}`} defaultValue={ing(`liquid_${i + 1}`)} className={selectClass}>
                <option value="">—</option>
                {config.sauces.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save configuration"}
        </button>
        {res && (
          <span className={`text-sm font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>
            {res.ok ? "Saved." : res.error}
          </span>
        )}
      </div>
    </form>
  );
}
