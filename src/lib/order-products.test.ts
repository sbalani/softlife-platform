import assert from "node:assert/strict";
import test from "node:test";
import { orderProductLabel, orderProductNames } from "./order-products.ts";

test("uses every stored product before the legacy first-product field", () => {
  const order = { product_name: "Oreo", products: [{ goodsName: "Oreo" }, { goodsName: "Pistachio" }] };
  assert.deepEqual(orderProductNames(order), ["Oreo", "Pistachio"]);
  assert.equal(orderProductLabel(order), "Oreo + Pistachio");
});

test("resolves each product independently and supports legacy rows", () => {
  assert.equal(orderProductLabel({ products: [{ goodsName: "oreo" }, { goodsName: "nuts" }] }, (name) => name.toUpperCase()), "OREO + NUTS");
  assert.equal(orderProductLabel({ product_name: "Vanilla", products: [] }), "Vanilla");
});
