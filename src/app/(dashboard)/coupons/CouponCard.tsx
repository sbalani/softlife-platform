"use client";

import { useState, useTransition } from "react";
import { generateCodes, fetchRecords, deleteCouponAction } from "./actions";
import type { HuaxinCoupon } from "@/lib/huaxin/client";

const TYPE_BADGE: Record<string, string> = {
  "0": "bg-terracotta/15 text-terracotta",
  "1": "bg-sage/15 text-sage",
  "2": "bg-rose/15 text-rose",
};
const TYPE_NAME: Record<string, string> = { "0": "Discount", "1": "One-cup", "2": "Secondary" };

type CodeRecord = { code?: string; status?: string; expireTime?: string; createTime?: string };
const STATUS: Record<string, string> = { "0": "Unused", "1": "Used", "2": "Expired" };

export function CouponCard({ coupon }: { coupon: HuaxinCoupon }) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [codes, setCodes] = useState<CodeRecord[] | null>(null);
  const [genCount, setGenCount] = useState("5");
  const [msg, setMsg] = useState<string | null>(null);

  const generate = () => {
    const n = parseInt(genCount, 10);
    if (!n) return;
    startTransition(async () => {
      const res = await generateCodes(coupon.couponId!, n);
      setMsg(res.ok ? `Generated ${n} code(s).` : res.error ?? "Failed");
    });
  };

  const viewCodes = () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    startTransition(async () => {
      const res = await fetchRecords(coupon.couponId!);
      setCodes(res.records as CodeRecord[]);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await deleteCouponAction(coupon.couponId!);
      setMsg(res.ok ? "Deleted." : res.error ?? "Failed");
    });
  };

  const ct = coupon.couponType ?? "0";

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-bold text-cocoa">{coupon.couponName ?? "Unnamed"}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_BADGE[ct] ?? "bg-cream text-taupe"}`}>{TYPE_NAME[ct] ?? ct}</span>
          </div>
          <p className="mt-1 text-xs text-taupe">
            ID {coupon.couponId}
            {coupon.startTime ? ` · ${coupon.startTime}` : ""}
            {coupon.endTime ? ` → ${coupon.endTime}` : ""}
            {coupon.validDay ? ` · ${coupon.validDay}d` : ""}
          </p>
          {coupon.deviceImeis && <p className="mt-0.5 text-xs text-taupe">Machines: {coupon.deviceImeis}</p>}
          {coupon.content && <p className="mt-0.5 text-xs text-taupe">{coupon.content}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={viewCodes} disabled={pending} className="text-xs font-bold text-terracotta hover:underline disabled:opacity-50">
            {expanded ? "Hide codes" : "View codes"}
          </button>
          <button onClick={remove} disabled={pending} className="text-xs font-bold text-danger hover:underline disabled:opacity-50">Delete</button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <input
          type="number" min="1" max="100" value={genCount}
          onChange={(e) => setGenCount(e.target.value)}
          className="w-16 rounded border border-line bg-white px-2 py-1 text-xs text-cocoa"
        />
        <button onClick={generate} disabled={pending} className="rounded bg-cocoa px-3 py-1 text-[10px] font-bold text-white hover:opacity-90 disabled:opacity-50">
          Generate codes
        </button>
        {msg && <span className="text-[10px] text-taupe">{msg}</span>}
      </div>

      {expanded && (
        <div className="mt-3 border-t border-line pt-3">
          {codes && codes.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase text-taupe"><tr><th className="py-1">Code</th><th className="py-1">Status</th><th className="py-1">Expires</th></tr></thead>
              <tbody className="divide-y divide-line">
                {codes.map((c, i) => (
                  <tr key={i}><td className="py-1 font-mono text-cocoa">{c.code ?? "—"}</td><td className="py-1 text-cocoa">{STATUS[String(c.status ?? "")] ?? c.status}</td><td className="py-1 text-taupe">{c.expireTime ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : codes ? <p className="text-xs text-taupe">No serial codes yet. Generate some above.</p> : <p className="text-xs text-taupe">Loading…</p>}
        </div>
      )}
    </div>
  );
}
