import assert from "node:assert/strict";
import test from "node:test";
import { cashDiscrepancyCents, parseEuroCents } from "./cashbox.ts";

test("parses euro amounts without floating point rounding", () => {
  assert.equal(parseEuroCents("12.34"), 1234);
  assert.equal(parseEuroCents("12,3"), 1230);
  assert.equal(parseEuroCents("0"), 0);
  assert.equal(parseEuroCents("1.234"), null);
  assert.equal(parseEuroCents("-1"), null);
});

test("calculates discrepancy after a partial withdrawal", () => {
  assert.equal(cashDiscrepancyCents(20_00, 12_00, 8_00), 0);
  assert.equal(cashDiscrepancyCents(20_00, 12_00, 7_50), -50);
});
