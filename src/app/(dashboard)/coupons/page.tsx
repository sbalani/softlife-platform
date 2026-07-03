import { getCoupons } from "@/lib/data/coupons";
import { CouponCreator } from "./CouponCreator";
import { CouponCard } from "./CouponCard";

export const dynamic = "force-dynamic";

export default async function CouponsPage() {
  const coupons = await getCoupons();

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Promotions</h1>
        <p className="mt-1 text-sm text-taupe">
          {coupons.length} coupon{coupons.length === 1 ? "" : "s"} — discounts, free-product vouchers &amp; multi-use cards
        </p>
      </header>

      <details className="mb-6 rounded-2xl border border-line bg-white p-5">
        <summary className="cursor-pointer font-display text-lg font-bold text-cocoa">Create coupon</summary>
        <div className="mt-4">
          <CouponCreator />
        </div>
      </details>

      <div className="space-y-4">
        {coupons.map((c) => (
          <CouponCard key={c.couponId ?? c.couponName} coupon={c} />
        ))}
      </div>

      {coupons.length === 0 && (
        <p className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">
          No coupons yet. Create discounts, free-product vouchers or multi-use cards above.
        </p>
      )}
    </div>
  );
}
