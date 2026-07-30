"use client";

import { useActionState, useState } from "react";
import { addCouponDays, couponDaysBetween } from "@/lib/coupon-dates";
import { createCouponAction, type CouponResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";
const TYPE_LABELS: Record<string, string> = { "0": "Discount", "1": "One-cup (free product)" };

type MachineOption = { id: string; name: string; imei: string };
type Values = {
  couponName: string; couponType: string; totalCount: string; startTime: string; endTime: string;
  validDay: string; localName: string; money: string; amount: string; productPosition: string;
  productName: string;
};

const INITIAL: Values = {
  couponName: "", couponType: "0", totalCount: "10", startTime: "", endTime: "",
  validDay: "30", localName: "", money: "1.00", amount: "1", productPosition: "1",
  productName: "",
};

export function CouponCreator({ machines }: { machines: MachineOption[] }) {
  const [res, action, pending] = useActionState<CouponResult | null, FormData>(createCouponAction, null);
  const [values, setValues] = useState(INITIAL);
  const [selectedImeis, setSelectedImeis] = useState<string[]>([]);
  const set = (field: keyof Values, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const changeStart = (startTime: string) => setValues((current) => ({ ...current, startTime, endTime: addCouponDays(startTime, Number(current.validDay)) }));
  const changeEnd = (endTime: string) => setValues((current) => ({ ...current, endTime, validDay: current.startTime ? String(couponDaysBetween(current.startTime, endTime)) : current.validDay }));
  const changeDays = (validDay: string) => setValues((current) => ({ ...current, validDay, endTime: current.startTime ? addCouponDays(current.startTime, Number(validDay)) : current.endTime }));

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label><span className={label}>Coupon name *</span><input name="couponName" required value={values.couponName} onChange={(event) => set("couponName", event.target.value)} placeholder="Summer promo" className={`w-full ${input}`} /></label>
        <label><span className={label}>Type</span><select name="couponType" value={values.couponType} onChange={(event) => set("couponType", event.target.value)} className={`w-full ${input}`}>{Object.entries(TYPE_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label><span className={label}>Serial codes to generate</span><input name="totalCount" type="number" min="0" max="100" value={values.totalCount} onChange={(event) => set("totalCount", event.target.value)} className={`w-full ${input}`} /></label>
        <label><span className={label}>Start date *</span><input name="startTime" type="date" required value={values.startTime} max={values.endTime || undefined} onChange={(event) => changeStart(event.target.value)} className={`w-full ${input}`} /></label>
        <label><span className={label}>End date *</span><input name="endTime" type="date" required value={values.endTime} min={values.startTime || undefined} onChange={(event) => changeEnd(event.target.value)} className={`w-full ${input}`} /></label>
        <label><span className={label}>Valid days *</span><input name="validDay" type="number" min="1" required value={values.validDay} onChange={(event) => changeDays(event.target.value)} className={`w-full ${input}`} /></label>
        <label className="sm:col-span-2"><span className={label}>Location label *</span><input name="localName" required value={values.localName} onChange={(event) => set("localName", event.target.value)} placeholder="Málaga" className={`w-full ${input}`} /></label>
      </div>

      <fieldset className="rounded-xl border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-3"><legend className="text-[11px] font-bold uppercase tracking-wide text-taupe">Machines</legend><button type="button" onClick={() => setSelectedImeis(selectedImeis.length === machines.length ? [] : machines.map((machine) => machine.imei))} className="text-xs font-semibold text-terracotta">{selectedImeis.length === machines.length ? "Clear" : "Select all"}</button></div>
        <input type="hidden" name="deviceImeis" value={selectedImeis.join(",")} />
        <p className="mb-2 text-xs text-taupe">Select at least one machine. Huaxin requires explicit IMEIs.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{machines.map((machine) => <label key={machine.id} className="flex cursor-pointer items-start gap-2 rounded-lg bg-cream/50 p-2 text-sm text-cocoa"><input type="checkbox" checked={selectedImeis.includes(machine.imei)} onChange={(event) => setSelectedImeis((current) => event.target.checked ? [...current, machine.imei] : current.filter((imei) => imei !== machine.imei))} className="mt-1 accent-terracotta" /><span><span className="block font-semibold">{machine.name}</span><span className="font-mono text-[10px] text-taupe">{machine.imei}</span></span></label>)}</div>
      </fieldset>

      <div className="rounded-xl border border-line bg-cream/40 p-3">
        <span className={label}>Coupon value ({TYPE_LABELS[values.couponType]})</span>
        {values.couponType === "0" && <label className="flex items-center gap-1"><span className="text-sm text-cocoa">€</span><input name="money" type="number" min="0.01" step="0.01" required value={values.money} onChange={(event) => set("money", event.target.value)} className={`w-32 ${input}`} /></label>}
        {values.couponType === "1" && <div className="flex flex-wrap gap-3"><label><span className={label}>Amount</span><input name="amount" type="number" min="1" required value={values.amount} onChange={(event) => set("amount", event.target.value)} className={`w-20 ${input}`} /></label><label><span className={label}>Position</span><input name="productPosition" required value={values.productPosition} onChange={(event) => set("productPosition", event.target.value)} className={`w-20 ${input}`} /></label><label><span className={label}>Product name</span><input name="productName" required value={values.productName} onChange={(event) => set("productName", event.target.value)} className={`w-40 ${input}`} /></label></div>}
      </div>

      <div className="flex items-center gap-4"><button disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{pending ? "Creating..." : "Create coupon"}</button>{res && <span className={`text-sm font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>{res.ok ? "Created." : res.error}</span>}</div>
    </form>
  );
}
