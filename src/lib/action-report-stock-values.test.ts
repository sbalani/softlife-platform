import assert from "node:assert/strict";
import test from "node:test";
import { menuStockCount, menuStockSnapshotItems } from "./action-report-stock-values.ts";

test("menu stock counters preserve zero and reject non-integer values", () => {
  assert.equal(menuStockCount(0), 0);
  assert.equal(menuStockCount("125"), 125);
  assert.equal(menuStockCount("1.5"), null);
  assert.equal(menuStockCount("unknown"), null);
});

test("stock snapshots freeze explicit DIY mappings without guessing recipe identity", () => {
  const items = menuStockSnapshotItems({
    diy: [{ position: 2, goodsName: "White Chocolate", stock: "80", enable: 1 }],
    unify: [{ position: 2, goodsName: "White Chocolate Cup", stock: 40, enable: 0 }],
  }, new Map([["2", "product-2"]]));
  assert.deepEqual(items.map((item) => ({ kind: item.menu_kind, stock: item.stock_count, product: item.platform_product_id, mapping: item.mapping_method })), [
    { kind: "diy", stock: 80, product: "product-2", mapping: "explicit_hopper_assignment" },
    { kind: "unify", stock: 40, product: null, mapping: "unresolved" },
  ]);
});
