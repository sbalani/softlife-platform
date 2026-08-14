"use client";

import { useState, useTransition } from "react";
import type { CouponRequest } from "@/lib/data/coupon-requests";
import { fetchGrantedCouponRecordsAction, grantCouponRequestAction, rejectCouponRequestAction } from "./actions";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  granting: "bg-terracotta/15 text-terracotta",
  granted: "bg-sage/15 text-sage",
  rejected: "bg-danger/10 text-danger",
  failed: "bg-danger/10 text-danger",
};

type CodeRecord = { code?: string; status?: string; expireTime?: string };
const CODE_STATUS: Record<string, string> = { "0": "Unused", "1": "Used", "2": "Expired" };

function RequestDetails({ request }: { request: CouponRequest }) {
  return (
    <div className="mt-3 grid gap-2 border-t border-line pt-3 text-xs text-taupe sm:grid-cols-2 lg:grid-cols-3">
      <p><span className="font-semibold text-cocoa">Value:</span> {request.couponType === "0" ? `€${request.money?.toFixed(2)}` : `${request.amount} × ${request.productName} (position ${request.productPosition})`}</p>
      <p><span className="font-semibold text-cocoa">Dates:</span> {request.startDate} to {request.endDate} ({request.validDay} days)</p>
      <p><span className="font-semibold text-cocoa">Codes:</span> {request.totalCount} · {request.usesPerCode} use{request.usesPerCode === 1 ? "" : "s"} each</p>
      <p><span className="font-semibold text-cocoa">Location:</span> {request.localName}</p>
      <p className="sm:col-span-2"><span className="font-semibold text-cocoa">Machines:</span> {request.machines.map((machine) => machine.name).join(", ") || "None"}</p>
      {request.reviewNote && <p className="sm:col-span-2 lg:col-span-3"><span className="font-semibold text-cocoa">Admin note:</span> {request.reviewNote}</p>}
      {request.grantError && <p className="text-danger sm:col-span-2 lg:col-span-3"><span className="font-semibold">Grant error:</span> {request.grantError}</p>}
    </div>
  );
}

export function AdminCouponRequests({ requests }: { requests: CouponRequest[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const actionable = requests.filter((request) => request.status === "pending" || request.status === "granting");
  const grant = (request: CouponRequest) => startTransition(async () => {
    if (!confirm(`Grant “${request.couponName}” to ${request.tenantName}? This creates the live Huaxin coupon.`)) return;
    const result = await grantCouponRequestAction(request.id);
    setMessage(result.ok ? result.warning ?? "Coupon granted." : result.error ?? "Grant failed.");
  });
  const reject = (request: CouponRequest) => {
    const note = prompt("Reason for rejection (optional)", "");
    if (note === null) return;
    startTransition(async () => {
      const result = await rejectCouponRequestAction(request.id, note);
      setMessage(result.ok ? "Request rejected." : result.error ?? "Rejection failed.");
    });
  };
  return (
    <section className="mb-6 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-xl font-bold text-cocoa">Franchisee requests</h2><p className="text-xs text-taupe">Review the requested scope before creating a live coupon.</p></div><span className="rounded-full bg-cream px-3 py-1 text-xs font-bold text-cocoa">{actionable.length} active</span></div>
      {message && <p className="mt-3 text-sm font-semibold text-taupe">{message}</p>}
      <div className="mt-4 space-y-3">
        {requests.map((request) => (
          <details key={request.id} className="rounded-xl border border-line bg-cream/25 p-4" open={request.status === "pending"}>
            <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="font-bold text-cocoa">{request.couponName}</span><span className="ml-2 text-xs text-taupe">{request.tenantName} · {request.requesterName}</span></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[request.status]}`}>{request.status}</span></div></summary>
            <RequestDetails request={request} />
            {request.status === "pending" && <div className="mt-3 flex gap-2"><button disabled={pending} onClick={() => grant(request)} className="rounded-lg bg-sage px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Grant coupon</button><button disabled={pending} onClick={() => reject(request)} className="rounded-lg border border-danger px-3 py-2 text-xs font-bold text-danger disabled:opacity-50">Reject</button></div>}
          </details>
        ))}
        {!requests.length && <p className="rounded-xl bg-cream/50 p-4 text-sm text-taupe">No franchisee coupon requests yet.</p>}
      </div>
    </section>
  );
}

function GrantedCoupon({ request }: { request: CouponRequest }) {
  const [pending, startTransition] = useTransition();
  const [codes, setCodes] = useState<CodeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => startTransition(async () => {
    if (codes) { setCodes(null); return; }
    const result = await fetchGrantedCouponRecordsAction(request.id);
    setError(result.error ?? null);
    if (!result.error) setCodes(result.records as CodeRecord[]);
  });
  return (
    <details className="rounded-2xl border border-sage/30 bg-white p-5">
      <summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><div><h3 className="font-display text-lg font-bold text-cocoa">{request.couponName}</h3><p className="text-xs text-taupe">{request.startDate} to {request.endDate} · {request.totalCount} code{request.totalCount === 1 ? "" : "s"}</p></div><span className="rounded-full bg-sage/15 px-2 py-1 text-[10px] font-bold uppercase text-sage">Granted</span></div></summary>
      <RequestDetails request={request} />
      <button onClick={load} disabled={pending} className="mt-4 rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Loading..." : codes ? "Hide coupon codes" : "Show coupon codes"}</button>
      {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      {codes && <div className="mt-3 overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[480px] text-xs"><thead className="bg-cream/60 text-left uppercase text-taupe"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Expires</th></tr></thead><tbody className="divide-y divide-line">{codes.map((code, index) => <tr key={`${code.code ?? "code"}-${index}`}><td className="px-3 py-2 font-mono font-bold text-cocoa">{code.code ?? "—"}</td><td className="px-3 py-2 text-cocoa">{CODE_STATUS[String(code.status ?? "")] ?? code.status ?? "—"}</td><td className="px-3 py-2 text-taupe">{code.expireTime ?? "—"}</td></tr>)}{!codes.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-taupe">No coupon codes were returned.</td></tr>}</tbody></table></div>}
    </details>
  );
}

export function FranchiseCouponRequests({ requests }: { requests: CouponRequest[] }) {
  const granted = requests.filter((request) => request.status === "granted");
  return (
    <div className="space-y-7">
      <section><h2 className="mb-3 font-display text-xl font-bold text-cocoa">Granted coupons</h2><div className="space-y-3">{granted.map((request) => <GrantedCoupon key={request.id} request={request} />)}{!granted.length && <p className="rounded-2xl border border-line bg-white p-5 text-sm text-taupe">Granted coupons will appear here with their usable codes.</p>}</div></section>
      <section><h2 className="mb-3 font-display text-xl font-bold text-cocoa">Request history</h2><div className="space-y-3">{requests.map((request) => <details key={request.id} className="rounded-xl border border-line bg-white p-4"><summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-cocoa">{request.couponName}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[request.status]}`}>{request.status}</span></div></summary><RequestDetails request={request} /></details>)}{!requests.length && <p className="rounded-xl border border-line bg-white p-4 text-sm text-taupe">No requests yet.</p>}</div></section>
    </div>
  );
}
