import assert from "node:assert/strict";
import test from "node:test";
import { buildCouponContent, parseCouponSecondary, parseCouponUseCount } from "./coupon-content.ts";

test("coupon content includes Huaxin secondary use count", () => {
  const content = buildCouponContent({ money: "1" }, 3);
  assert.deepEqual(JSON.parse(content), { money: "1", secondary: "3" });
  assert.equal(parseCouponSecondary(content), 3);
  assert.deepEqual(JSON.parse(buildCouponContent({ amount: "1", productPosition: "2", productName: "Vanilla" }, 2)), {
    amount: "1", productPosition: "2", productName: "Vanilla", secondary: "2",
  });
  assert.equal(parseCouponSecondary("invalid"), null);
  assert.equal(parseCouponSecondary('{"secondary":true}'), null);
  assert.equal(parseCouponUseCount("0"), null);
  assert.equal(parseCouponUseCount("1.5"), null);
  assert.equal(parseCouponUseCount("abc"), null);
  assert.equal(parseCouponUseCount("9007199254740993"), null);
});
