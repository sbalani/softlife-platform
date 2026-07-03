"use client";

import { useActionState } from "react";
import { updateDeviceBranding, type BrandingResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function DeviceBrandingForm({ imei }: { imei: string }) {
  const [res, action, pending] = useActionState<BrandingResult | null, FormData>(updateDeviceBranding, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="imei" value={imei} />
      <label className="block">
        <span className={label}>Display label</span>
        <input name="deviceLabel" placeholder="Machine name" className={`w-40 ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Merchant</span>
        <input name="deviceMerchant" placeholder="SoftLife" className={`w-32 ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Phone</span>
        <input name="deviceTel" placeholder="+34…" className={`w-32 ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Language</span>
        <select name="language" className={input}>
          <option value="">—</option>
          <option value="US">English</option>
          <option value="ES">Español</option>
          <option value="CN">中文</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">
        {pending ? "Updating…" : "Update"}
      </button>
      {res && <span className={`text-xs font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>{res.ok ? "Updated." : res.error}</span>}
    </form>
  );
}
