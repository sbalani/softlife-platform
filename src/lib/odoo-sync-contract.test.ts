import assert from "node:assert/strict";
import test from "node:test";
import {
  inclusiveLocalDatePeriod,
  canonicalJson, decodeSyncCursor, encodeSyncCursor, isEligibleManufacturingSale, isSyncCursor,
  localDateTimeToUtc, normalizeObservedName, productionDocumentDate, sha256,
} from "./odoo-sync-contract.ts";

test("observed names normalize Unicode and whitespace consistently", () => {
  assert.equal(normalizeObservedName("  OREO\u00a0  Topping  "), "oreo topping");
  assert.equal(normalizeObservedName("ＯＲＥＯ"), "oreo");
});

test("sync cursors are opaque, versioned, and validated", () => {
  const value = { timestamp: "2026-08-26T10:00:00Z", id: "row" };
  assert.deepEqual(decodeSyncCursor(encodeSyncCursor(value), isSyncCursor), value);
  assert.equal(decodeSyncCursor("invalid", isSyncCursor), null);
});

test("payload hashing is independent of object key insertion order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
});

test("manufacturing eligibility excludes overrides, refunds, and invalid units", () => {
  const sale = { order_state: "COMPLETE", refund_status: "None", pay_type_raw: "刷卡", nums: 2 };
  assert.equal(isEligibleManufacturingSale(sale), true);
  assert.equal(isEligibleManufacturingSale({ ...sale, refund_status: "Refunded" }), false);
  assert.equal(isEligibleManufacturingSale({ ...sale, pay_type_raw: "自动制作" }), false);
  assert.equal(isEligibleManufacturingSale({ ...sale, nums: 1.5 }), false);
});

test("Madrid period boundaries preserve DST and use the final included date", () => {
  assert.deepEqual(inclusiveLocalDatePeriod("2026-07-09", "2026-07-10"), { localFrom: "2026-07-09T00:00", localTo: "2026-07-11T00:00" });
  assert.equal(localDateTimeToUtc("2026-03-28T00:00", "Europe/Madrid"), "2026-03-27T23:00:00.000Z");
  assert.equal(localDateTimeToUtc("2026-03-30T00:00", "Europe/Madrid"), "2026-03-29T22:00:00.000Z");
  assert.equal(productionDocumentDate("2026-09-01T00:00:00"), "2026-08-31");
  assert.equal(productionDocumentDate("2026-09-01T15:00:00"), "2026-09-01");
  assert.throws(() => inclusiveLocalDatePeriod("2026-07-10", "2026-07-09"), /valid inclusive date range/);
});
