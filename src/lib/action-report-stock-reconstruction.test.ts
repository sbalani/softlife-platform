import assert from "node:assert/strict";
import test from "node:test";
import { reconstructStockAtAction, type StockReconstructionOrder } from "./action-report-stock-reconstruction.ts";

const baseOrder: StockReconstructionOrder = {
  orderTime: "2026-09-02T12:00:00Z",
  orderState: "COMPLETE",
  refundStatus: null,
  payTypeRaw: "card",
  nums: 1,
  products: [{ position: 2 }],
  listRaw: { productName: "Large cup" },
};

test("adds completed consumption back to the delayed observed stock", () => {
  const [item] = reconstructStockAtAction(
    [{ menuKind: "diy", position: "2", goodsName: "Chocolate", observedStock: 982 }],
    [baseOrder, { ...baseOrder, orderTime: "2026-09-03T12:00:00Z", nums: 2 }],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    true,
  );
  assert.equal(item.consumedSinceAction, 3);
  assert.equal(item.stockAtAction, 985);
  assert.equal(item.calculationComplete, true);
});

test("uses the exact action-to-capture interval and completed orders only", () => {
  const [item] = reconstructStockAtAction(
    [{ menuKind: "diy", position: "2", goodsName: "Chocolate", observedStock: 100 }],
    [
      { ...baseOrder, orderTime: "2026-09-01T10:00:00Z" },
      { ...baseOrder, orderTime: "2026-09-02T12:00:00Z", orderState: "MAKING" },
      { ...baseOrder, orderTime: "2026-09-04T10:00:01Z" },
    ],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    true,
  );
  assert.equal(item.consumedSinceAction, 0);
  assert.equal(item.stockAtAction, 100);
});

test("counts a position once per order and marks incomplete source data", () => {
  const [item] = reconstructStockAtAction(
    [{ menuKind: "diy", position: "2", goodsName: "Chocolate", observedStock: 100 }],
    [{ ...baseOrder, nums: 2, products: [{ position: 2 }, { position: 2 }] }, { ...baseOrder, products: [] }],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    true,
  );
  assert.equal(item.consumedSinceAction, 2);
  assert.equal(item.stockAtAction, null);
  assert.equal(item.calculationComplete, false);
});

test("reconstructs unified menu counters by the sold menu name", () => {
  const [item] = reconstructStockAtAction(
    [{ menuKind: "unify", position: "7", goodsName: "Large Cup", observedStock: 40 }],
    [{ ...baseOrder, nums: 3, listRaw: { productName: " large cup " } }],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    true,
  );
  assert.equal(item.consumedSinceAction, 3);
  assert.equal(item.stockAtAction, 43);
});

test("does not present a result when historical order coverage is incomplete", () => {
  const [item] = reconstructStockAtAction(
    [{ menuKind: "diy", position: "2", goodsName: "Chocolate", observedStock: 100 }],
    [baseOrder],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    false,
  );
  assert.equal(item.consumedSinceAction, 1);
  assert.equal(item.stockAtAction, null);
  assert.equal(item.calculationComplete, false);
});

test("uses the existing financial sales definition", () => {
  const [item] = reconstructStockAtAction(
    [{ menuKind: "diy", position: "2", goodsName: "Chocolate", observedStock: 100 }],
    [{ ...baseOrder, refundStatus: "1" }, { ...baseOrder, payTypeRaw: "自动制作" }],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    true,
  );
  assert.equal(item.consumedSinceAction, 0);
  assert.equal(item.stockAtAction, 100);
});

test("marks partial DIY position evidence incomplete", () => {
  const [item] = reconstructStockAtAction(
    [{ menuKind: "diy", position: "2", goodsName: "Chocolate", observedStock: 100 }],
    [{ ...baseOrder, products: [{ position: 2 }, {}] }],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    true,
  );
  assert.equal(item.stockAtAction, null);
  assert.equal(item.incompleteReason, "sales data is missing menu positions");
});

test("marks duplicate unified names ambiguous", () => {
  const items = reconstructStockAtAction(
    [
      { menuKind: "unify", position: "7", goodsName: "Large cup", observedStock: 40 },
      { menuKind: "unify", position: "8", goodsName: "Large cup", observedStock: 50 },
    ],
    [{ ...baseOrder, listRaw: { productName: "Large cup" } }],
    "2026-09-01T10:00:00Z",
    "2026-09-04T10:00:00Z",
    true,
  );
  assert.ok(items.every((item) => !item.calculationComplete && item.incompleteReason === "sold menu identity is ambiguous"));
});
