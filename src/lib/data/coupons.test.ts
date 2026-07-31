import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCouponSnapshots } from "./coupon-snapshot-aggregation.ts";

test("coupon snapshots deduplicate definitions and derive machine assignments", () => {
  assert.deepEqual(aggregateCouponSnapshots([
    { device_imei: "222", synced_at: "2026-07-30", coupons: [{ couponId: 7, couponName: "Old promo" }] },
    { device_imei: "111", synced_at: "2026-07-31", coupons: [{ couponId: 7, couponName: "Promo" }, { couponId: 8, couponName: "Single" }] },
  ]), [
    { couponId: 7, couponName: "Promo", deviceImeis: "111,222" },
    { couponId: 8, couponName: "Single", deviceImeis: "111" },
  ]);
});
