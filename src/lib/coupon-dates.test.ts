import assert from "node:assert/strict";
import test from "node:test";
import { addCouponDays, couponDaysBetween } from "./coupon-dates.ts";

test("coupon duration updates its end date", () => {
  assert.equal(addCouponDays("2026-07-30", 30), "2026-08-29");
});

test("coupon end date updates its duration", () => {
  assert.equal(couponDaysBetween("2026-07-30", "2026-08-29"), 30);
});
