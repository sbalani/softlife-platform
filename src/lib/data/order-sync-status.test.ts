import assert from "node:assert/strict";
import test from "node:test";
import { coversOrderRange, orderReadFreshness, orderSyncStatus } from "./order-sync-status.ts";

test("order sync status reflects complete, partial, and total failure", () => {
  assert.equal(orderSyncStatus(3, 0), "succeeded");
  assert.equal(orderSyncStatus(2, 1), "partial");
  assert.equal(orderSyncStatus(0, 3), "failed");
  assert.equal(orderSyncStatus(0, 0), "failed");
});

test("contiguous successful pulls establish range coverage", () => {
  assert.equal(coversOrderRange([
    { from: "2026-07-01", through: "2026-07-15" },
    { from: "2026-07-16", through: "2026-07-31" },
  ], "2026-07-01", "2026-07-31"), true);
  assert.equal(coversOrderRange([
    { from: "2026-07-01", through: "2026-07-14" },
    { from: "2026-07-16", through: "2026-07-31" },
  ], "2026-07-01", "2026-07-31"), false);
});

test("order read freshness is conservative about fleet coverage", () => {
  assert.equal(orderReadFreshness(null, "2026-07-31"), "missing");
  assert.equal(orderReadFreshness({ status: "partial", requestedTo: "2026-07-31" }, "2026-07-31"), "warning");
  assert.equal(orderReadFreshness({ status: "succeeded", requestedTo: "2026-07-30" }, "2026-07-31"), "stale");
  assert.equal(orderReadFreshness({ status: "succeeded", requestedTo: "2026-07-31" }, "2026-07-31"), "current");
});
