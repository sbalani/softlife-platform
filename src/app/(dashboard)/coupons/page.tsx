import { getCoupons } from "@/lib/data/coupons";
import { CouponCreator } from "./CouponCreator";
import { CouponCard } from "./CouponCard";
import { getMachines } from "@/lib/data/machines";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getSessionProfile } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getAccessibleMachines } from "@/lib/data/accessible-machines";
import { getCouponRequests } from "@/lib/data/coupon-requests";
import { AdminCouponRequests, FranchiseCouponRequests } from "./CouponRequests";

export const dynamic = "force-dynamic";

export default async function CouponsPage() {
  const session = await getSessionProfile();
  if (!session || session.role === "operator") redirect("/dashboard");
  if (session.role === "franchisee") {
    const [machines, requests] = await Promise.all([getAccessibleMachines(), getCouponRequests(session)]);
    return (
      <div>
        <header className="mb-8"><p className="text-xs font-bold uppercase tracking-[.2em] text-terracotta">Franchise promotions</p><h1 className="mt-1 font-display text-3xl font-bold text-cocoa">Coupons</h1><p className="mt-1 text-sm text-taupe">Request coupon codes for your assigned machines and access them after approval.</p></header>
        <details className="mb-7 rounded-2xl border border-line bg-white p-5">
          <summary className="cursor-pointer font-display text-lg font-bold text-cocoa">Request a coupon</summary>
          <div className="mt-4"><CouponCreator request machines={machines.map((machine) => ({ id: machine.id, name: machine.display_name || machine.name, imei: machine.device_imei }))} /></div>
        </details>
        <FranchiseCouponRequests requests={requests} />
      </div>
    );
  }
  const [{ machines }, { coupons, latestSyncedAt, staleMachines, readError }, tz, requests] = await Promise.all([getMachines(), getCoupons(), getDisplayTimezone(), getCouponRequests(session)]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Promotions</h1>
        <p className="mt-1 text-sm text-taupe">
          {coupons.length} coupon{coupons.length === 1 ? "" : "s"} — discounts and one-cup vouchers
        </p>
      </header>

      <AdminCouponRequests requests={requests} />

      <p className={`mb-4 text-xs ${readError ? "font-semibold text-danger" : staleMachines ? "font-semibold text-warning" : "text-taupe"}`}>
        {readError ? `Supabase coupon read failed: ${readError}` : `Supabase snapshot · Latest coupon sync ${latestSyncedAt ? formatDateTime(latestSyncedAt, tz) : "never"}${staleMachines ? ` · ${staleMachines} machine snapshot(s) are stale or missing` : ""}`}
      </p>

      <details className="mb-6 rounded-2xl border border-line bg-white p-5">
        <summary className="cursor-pointer font-display text-lg font-bold text-cocoa">Create coupon</summary>
        <div className="mt-4">
          <CouponCreator machines={machines.filter((machine) => machine.device_imei).map((machine) => ({ id: machine.id, name: machine.name, imei: machine.device_imei! }))} />
        </div>
      </details>

      <div className="space-y-4">
        {coupons.map((c) => (
          <CouponCard key={c.couponId ?? c.couponName} coupon={c} />
        ))}
      </div>

      {!readError && coupons.length === 0 && (
        <p className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">
          No coupons yet. Create a discount or one-cup voucher above.
        </p>
      )}
    </div>
  );
}
