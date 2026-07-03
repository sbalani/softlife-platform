"use client";

import { useState } from "react";
import { useActionState } from "react";
import { createCouponAction, type CouponResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

const TYPE_LABELS: Record<string, string> = { "0": "Discount", "1": "One-cup (free product)", "2": "Secondary card (count)" };

export function CouponCreator() {
  const [res, action, pending] = useActionState<CouponResult | null, FormData>(createCouponAction, null);
  const [type, setType] = useState("0");

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={label}>Coupon name *</span>
          <input name="couponName" required placeholder="Summer promo" className={`w-full ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Type</span>
          <select name="couponType" value={type} onChange={(e) => setType(e.target.value)} className={`w-full ${input}`}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Serial codes to generate</span>
          <input name="totalCount" type="number" min="0" max="100" defaultValue="10" className={`w-full ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Start date</span>
          <input name="startTime" type="date" className={`w-full ${input}`} />
        </label>
        <label className="block">
          <span className={label}>End date</span>
          <input name="endTime" type="date" className={`w-full ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Valid (days)</span>
          <input name="validDay" type="number" defaultValue="30" className={`w-full ${input}`} />
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>Machine IMEIs (comma-separated)</span>
          <input name="deviceImeis" placeholder="867734089182113, 8677…" className={`w-full ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Location label</span>
          <input name="localName" placeholder="Málaga" className={`w-full ${input}`} />
        </label>
      </div>

      {/* Type-specific content */}
      <div className="rounded-xl border border-line bg-cream/40 p-3">
        <span className={label}>Coupon value ({TYPE_LABELS[type]})</span>
        {type === "0" && (
          <label className="block"><span className="sr-only">Discount amount</span>
            <div className="flex items-center gap-1"><span className="text-sm text-cocoa">€</span>
            <input name="money" type="number" step="0.01" defaultValue="1.00" placeholder="1.00" className={`w-32 ${input}`} /></div>
          </label>
        )}
        {type === "1" && (
          <div className="flex flex-wrap gap-3">
            <label className="block"><span className={label}>Amount</span><input name="amount" type="number" defaultValue="1" className={`w-20 ${input}`} /></label>
            <label className="block"><span className={label}>Position</span><input name="productPosition" defaultValue="1" className={`w-20 ${input}`} /></label>
            <label className="block"><span className={label}>Product name</span><input name="productName" placeholder="Vanilla Soft" className={`w-40 ${input}`} /></label>
          </div>
        )}
        {type === "2" && (
          <label className="block"><span className={label}>Uses per card</span><input name="secondary" type="number" defaultValue="5" className={`w-24 ${input}`} /></label>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">
          {pending ? "Creating…" : "Create coupon"}
        </button>
        {res && <span className={`text-sm font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>{res.ok ? "Created." : res.error}</span>}
      </div>
    </form>
  );
}
