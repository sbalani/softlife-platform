import test from "node:test";
import assert from "node:assert/strict";
import { COUPON_PATHS, couponApiError } from "./client.ts";

test("coupon endpoints match the Huaxin contract", () => {
  assert.deepEqual(COUPON_PATHS, {
    edit: "/machine/cloud/api/coupon/edit",
    list: "/machine/cloud/api/coupon/list",
    generate: "/machine/cloud/api/coupon/generate/records",
    records: "/machine/cloud/api/coupon/records/list",
    delete: "/machine/cloud/api/coupon/del",
  });
});

test("a business-level rejection is not reported as success", () => {
  assert.equal(couponApiError({ code: 200, result: false, msg: "Rejected" }), "Rejected");
  assert.equal(couponApiError({ code: 200, result: true, data: { result: false, message: "Not added" } }), "Not added");
  assert.equal(couponApiError({ code: 200, result: true, data: { result: true } }), null);
});
