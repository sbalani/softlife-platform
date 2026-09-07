import assert from "node:assert/strict";
import test from "node:test";
import { isValidBottleQuantity, refillInventoryQuantity } from "./action-report-refills.ts";

test("unfinished topping bottles reduce the reconciliation quantity by one", () => {
  assert.equal(refillInventoryQuantity(1, true), 0);
  assert.equal(refillInventoryQuantity(1, false), 1);
  assert.equal(refillInventoryQuantity(3, true), 2);
  assert.equal(refillInventoryQuantity(3, false), 3);
});

test("bottle tracking requires whole bottle quantities", () => {
  assert.equal(isValidBottleQuantity(1.5, false, false), true);
  assert.equal(isValidBottleQuantity(1.5, true, false), false);
  assert.equal(isValidBottleQuantity(2, true, true), true);
});
