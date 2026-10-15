"use client";

import { useState, useTransition } from "react";
import { generateCodes, fetchRecords, deleteCouponAction } from "./actions";
import { parseCouponSecondary } from "@/lib/coupon-content";
import type { CouponCodeRecord } from "@/lib/coupon-code-metadata";
import { CouponCodeTable } from "./CouponCodeTable";
import type { CouponGroup } from "@/lib/coupon-groups";

const TYPE_BADGE: Record<string, string> = {
  "0": "bg-terracotta/15 text-terracotta",
  "1": "bg-sage/15 text-sage",
};
const TYPE_NAME: Record<string, string> = { "0": "Discount", "1": "One-cup" };

export function CouponCard({ coupon }: { coupon: CouponGroup }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<CouponCodeRecord[] | null>(null);
  const [genCount, setGenCount] = useState("5");
  const [msg, setMsg] = useState<string | null>(null);

  const generate = () => {
    const n = parseInt(genCount, 10);
    if (!n) return;
    startTransition(async () => {
      const res = await generateCodes(String(coupon.couponId), n);
      setMsg(res.ok ? `Generated ${n} code(s).` : res.error ?? "Failed");
      if (res.ok) {
        const loaded = await fetchRecords(String(coupon.couponId));
        setCodes(loaded.records as CouponCodeRecord[]);
        if (loaded.error) setMsg(loaded.error);
      }
    });
  };

  const loadCodes = () => {
    if (pending) return;
    startTransition(async () => {
      const res = await fetchRecords(String(coupon.couponId));
      if (res.error) { setCodes([]); setMsg(res.error); }
      else setCodes(res.records as CouponCodeRecord[]);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await deleteCouponAction(String(coupon.couponId));
      setMsg(res.ok ? res.warning ?? "Deleted." : res.error ?? "Failed");
    });
  };

  const ct = coupon.couponType ?? "0";
  const secondary = parseCouponSecondary(coupon.content);

  return (
    <details className="group rounded-2xl border border-line bg-white shadow-sm transition open:border-terracotta/30" onToggle={(event) => { const next = event.currentTarget.open; setOpen(next); if (next) loadCodes(); }}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-display text-lg font-bold text-cocoa">{coupon.couponName ?? "Unnamed"}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_BADGE[ct] ?? "bg-cream text-taupe"}`}>{TYPE_NAME[ct] ?? ct}</span>{coupon.availableCount > 0 ? <span className="rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-bold text-sage">{coupon.availableCount} available</span> : <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">No available codes</span>}</div><p className="mt-1 text-xs text-taupe">ID {coupon.couponId}{coupon.startTime ? ` · ${coupon.startTime}` : ""}{coupon.endTime ? ` → ${coupon.endTime}` : ""}</p></div>
          <div className="flex shrink-0 items-center gap-4 text-xs"><span className="text-taupe">{coupon.distributedCount} distributed · {coupon.usedCount} used</span><span className="font-bold text-terracotta">{open ? "Close" : "Open"}</span><span aria-hidden className="text-lg text-terracotta transition group-open:rotate-180">⌄</span></div>
        </div>
      </summary>

      <div className="border-t border-line px-4 pb-5 pt-4 sm:px-5">
        {coupon.validDay && <p className="text-xs text-taupe">Duration: {coupon.validDay} days</p>}
        {coupon.deviceImeis && <p className="mt-1 text-xs text-taupe">Machines: {coupon.deviceImeis}</p>}
        {coupon.content && <p className="mt-1 text-xs text-taupe">{coupon.content}</p>}
        {secondary && <p className="mt-1 text-xs font-semibold text-cocoa">Uses per code: {secondary}</p>}
        {coupon.availabilityError && <p className="mt-2 text-xs font-semibold text-warning">Availability could not be refreshed: {coupon.availabilityError}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <input
          type="number" min="1" max="100" value={genCount}
          onChange={(e) => setGenCount(e.target.value)}
          className="w-16 rounded border border-line bg-white px-2 py-1 text-xs text-cocoa"
        />
        <button onClick={generate} disabled={pending} className="rounded bg-cocoa px-3 py-1 text-[10px] font-bold text-white hover:opacity-90 disabled:opacity-50">
          Generate codes
        </button>
        <button onClick={remove} disabled={pending} className="ml-auto text-xs font-bold text-danger hover:underline disabled:opacity-50">Delete</button>
        {msg && <span className="text-[10px] text-taupe">{msg}</span>}
      </div>

        <div className="mt-4 border-t border-line pt-4">
          {codes ? <CouponCodeTable records={codes} couponId={String(coupon.couponId)} /> : <p className="text-xs text-taupe">Loading...</p>}
        </div>
      </div>
    </details>
  );
}
