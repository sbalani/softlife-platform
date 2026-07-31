import assert from "node:assert/strict";
import test from "node:test";
import { orderSyncStatus } from "./order-sync-status.ts";

test("order sync status reflects complete, partial, and total failure", () => {
  assert.equal(orderSyncStatus(3, 0), "succeeded");
  assert.equal(orderSyncStatus(2, 1), "partial");
  assert.equal(orderSyncStatus(0, 3), "failed");
  assert.equal(orderSyncStatus(0, 0), "failed");
});
