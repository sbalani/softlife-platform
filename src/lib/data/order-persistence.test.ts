import assert from "node:assert/strict";
import test from "node:test";
import { orderPatchFromWebhook, orderRowFromHuaxin, tenantForOrder } from "./order-persistence.ts";

const source = {
  orderCode: "order-1",
  outTradeNo: "payment-1",
  status: 3,
  price: "4.20",
  marketPrice: 4.6,
  discountPrice: "0.40",
  rePrice: "0.00",
  amount: 1,
  nums: 1,
  goodsName: "Fallback",
  products: [{ goodsName: "Oreo", price: "0.4", position: 2 }],
  payType: "刷卡支付",
  localPayTime: "2026-07-22 02:54:15",
  createTimeUtc: "2026-07-30T11:40:17Z",
  refundStatus: 0,
  refundOutNo: null,
  coupon: { result: true },
  activityName: "Promotion",
  deviceLabel: "Machine",
};

test("pull persistence retains complete order and provenance", () => {
  const row = orderRowFromHuaxin(source, { id: "machine", tenantId: "tenant", imei: "123" });
  assert.equal(row.order_time, "2026-07-21T18:54:15.000Z");
  assert.equal(row.create_time_utc, "2026-07-30T11:40:17Z");
  assert.equal(row.product_name, "Oreo");
  assert.deepEqual(row.products, source.products);
  assert.equal(row.market_price, 4.6);
  assert.equal(row.discount_price, 0.4);
  assert.equal(row.coupon_used, true);
  assert.deepEqual(row.list_raw, source);
});

test("a later pull intentionally emits the current Huaxin product name", () => {
  const renamed = orderRowFromHuaxin({ ...source, products: [{ ...source.products[0], goodsName: "Canonical Oreo" }] }, { id: "machine", tenantId: null, imei: "123" });
  assert.equal(renamed.product_name, "Canonical Oreo");
});

test("a sparse webhook preserves omissions instead of inventing defaults", () => {
  const patch = orderPatchFromWebhook({ responType: "order", data: { orderCode: "order-1", status: 3 } })!;
  assert.equal(patch.order_code, "order-1");
  assert.equal(patch.status_code, "3");
  assert.equal("price" in patch, false);
  assert.equal("product_name" in patch, false);
  assert.equal("list_raw" in patch, false);
});

test("a webhook without an order code is rejected", () => {
  assert.equal(orderPatchFromWebhook({ responType: "order", data: {} }), null);
});

test("order ownership follows the assignment effective on the sale date", () => {
  const assignments = [
    { machine_id: "machine", tenant_id: "old", start_date: "2026-07-01", end_date: "2026-07-20" },
    { machine_id: "machine", tenant_id: "new", start_date: "2026-07-21", end_date: null },
  ];
  assert.equal(tenantForOrder(assignments, "machine", "2026-07-19T12:00:00Z"), "old");
  assert.equal(tenantForOrder(assignments, "machine", "2026-07-22T12:00:00Z"), "new");
});
