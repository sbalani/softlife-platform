"use client";

import { useState, useTransition } from "react";
import type { CouponCodeRecord } from "@/lib/coupon-code-metadata";
import { updateCouponCodeAction, updateGrantedCouponCodeAction, type CouponResult } from "./actions";

const STATUS: Record<string, string> = { "0": "Unused", "1": "Used", "2": "Expired" };

function DistributionFields({ record, save }: { record: CouponCodeRecord; save: (distributed: boolean, information: string, expectedRevision: number | null) => Promise<CouponResult> }) {
  const [distributed, setDistributed] = useState(record.distributed);
  const [information, setInformation] = useState(record.extraInformation ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(record.metadataRevision);
  const [pending, startTransition] = useTransition();
  const codeAvailable = Boolean(record.code);

  function updateDistribution(next: boolean) {
    const previous = distributed;
    setDistributed(next);
    setMessage(null);
    startTransition(async () => {
      const result = await save(next, information, revision);
      if (!result.ok) setDistributed(previous);
      else setRevision(result.revision ?? revision);
      setMessage(result.ok ? (next ? "Marked distributed." : "Marked not distributed.") : result.error ?? "Unable to save.");
    });
  }

  function saveInformation() {
    setMessage(null);
    startTransition(async () => {
      const result = await save(distributed, information, revision);
      if (result.ok) setRevision(result.revision ?? revision);
      setMessage(result.ok ? "Information saved." : result.error ?? "Unable to save.");
    });
  }

  return <>
    <td className="px-3 py-2 align-top"><label className="inline-flex items-center gap-2 font-semibold text-cocoa"><input type="checkbox" checked={distributed} disabled={pending || !codeAvailable} onChange={(event) => updateDistribution(event.target.checked)} className="h-4 w-4 accent-terracotta" />Distributed</label></td>
    <td className="min-w-64 px-3 py-2 align-top"><div className="flex gap-2"><input value={information} maxLength={1000} disabled={pending || !codeAvailable} onChange={(event) => setInformation(event.target.value)} placeholder="Optional recipient or distribution details" className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none" /><button type="button" disabled={pending || !codeAvailable} onClick={saveInformation} className="rounded-lg border border-terracotta px-2 py-1 text-[10px] font-bold text-terracotta disabled:opacity-50">{pending ? "Saving..." : "Save"}</button></div>{message && <p className={`mt-1 text-[10px] font-semibold ${message.includes("saved") || message.includes("Marked") ? "text-sage" : "text-danger"}`}>{message}</p>}</td>
  </>;
}

export function CouponCodeTable({ records, couponId, requestId }: { records: CouponCodeRecord[]; couponId?: string; requestId?: string }) {
  const save = (code: string) => (distributed: boolean, information: string, expectedRevision: number | null) => couponId
    ? updateCouponCodeAction(couponId, code, distributed, information, expectedRevision)
    : updateGrantedCouponCodeAction(requestId ?? "", code, distributed, information, expectedRevision);
  return <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[860px] text-xs"><thead className="bg-cream/60 text-left text-[10px] uppercase text-taupe"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2">Given out</th><th className="px-3 py-2">Extra information</th></tr></thead><tbody className="divide-y divide-line">{records.map((record, index) => <tr key={`${record.code ?? "code"}-${index}-${record.metadataRevision ?? 0}`}><td className="px-3 py-2 align-top font-mono font-bold text-cocoa">{record.code ?? "-"}</td><td className="px-3 py-2 align-top text-cocoa">{STATUS[String(record.status ?? "")] ?? String(record.status ?? "-")}</td><td className="px-3 py-2 align-top text-taupe">{record.expireTime ?? "-"}</td><DistributionFields record={record} save={save(record.code ?? "")} /></tr>)}{!records.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-taupe">No coupon codes were returned.</td></tr>}</tbody></table></div>;
}
