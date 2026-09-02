import assert from "node:assert/strict";
import test from "node:test";
import { convertPortionToStock } from "./production-units.ts";

test("converts grams into fractional package units", () => {
  const result = convertPortionToStock({ quantity: 100, uom: "g", stockUom: "Units", packageContentQuantity: 1120, packageContentUom: "g" });
  assert.equal(result.stockUom, "unit");
  assert.equal(result.packageContentQuantity, 1120);
  assert.ok(Math.abs(result.stockQuantity - 0.08928571428571429) < 1e-12);
  assert.ok(Math.abs(convertPortionToStock({ quantity: 100, uom: "g", stockUom: "Units", packageContentQuantity: 1.12, packageContentUom: "kg" }).stockQuantity - result.stockQuantity) < 1e-12);
});

test("normalizes compatible weight and volume units", () => {
  assert.equal(convertPortionToStock({ quantity: 100, uom: "g", stockUom: "kg" }).stockQuantity, 0.1);
  assert.equal(convertPortionToStock({ quantity: 120, uom: "ml", stockUom: "L" }).stockQuantity, 0.12);
});

test("rejects missing or dimensionally incompatible package content", () => {
  assert.throws(() => convertPortionToStock({ quantity: 100, uom: "g", stockUom: "Units" }), /missing net content/);
  assert.throws(() => convertPortionToStock({ quantity: 100, uom: "g", stockUom: "Units", packageContentQuantity: 1, packageContentUom: "L" }), /incompatible/);
});
