import assert from "node:assert/strict";
import test from "node:test";
import { mergeCouponCodeMetadata, validateCouponCodeMetadata } from "./coupon-code-metadata.ts";

test("coupon metadata defaults to undistributed and preserves Huaxin fields", () => {
  assert.deepEqual(mergeCouponCodeMetadata([{ code: "A1", status: "1", provider: "kept" }], []), [
    { code: "A1", status: "1", provider: "kept", distributed: false, extraInformation: null, metadataRevision: null },
  ]);
});

test("coupon metadata merges by exact code without changing redemption status", () => {
  const records = [{ code: "A1", status: "0" }, { code: "A10", status: "2" }];
  const metadata = [{ huaxin_coupon_id: "7", coupon_code: "A1", distributed: true, extra_information: "Front desk", revision: 3 }];
  assert.deepEqual(mergeCouponCodeMetadata(records, metadata), [
    { code: "A1", status: "0", distributed: true, extraInformation: "Front desk", metadataRevision: 3 },
    { code: "A10", status: "2", distributed: false, extraInformation: null, metadataRevision: null },
  ]);
});

test("coupon metadata accepts an empty optional note and limits its length", () => {
  assert.deepEqual(validateCouponCodeMetadata(" A1 ", "  "), { code: "A1", extraInformation: null });
  assert.equal(validateCouponCodeMetadata("A1", "x".repeat(1001)).error, "Extra information must be 1,000 characters or fewer.");
});
