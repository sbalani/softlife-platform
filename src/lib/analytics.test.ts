import assert from "node:assert/strict";
import test from "node:test";
import { analyticsRange, filterAnalyticsOrders } from "./analytics.ts";
import type { Order } from "./data/orders.ts";

test("analytics range creates an equal previous period", () => {
  const range = analyticsRange({ dateFrom: "2026-07-01", dateTo: "2026-07-07" }, "Europe/Madrid");
  assert.deepEqual({ from: range.from, to: range.to, days: range.days, previousFrom: range.previousFrom, previousTo: range.previousTo }, {
    from: "2026-07-01",
    to: "2026-07-07",
    days: 7,
    previousFrom: "2026-06-24",
    previousTo: "2026-06-30",
  });
});

test("analytics filters resolve product aliases", () => {
  const order = { device_imei: "123", pay_type: "Card", products: [], product_name: "Old Vanilla" } as unknown as Order;
  const aliases = new Map([["old vanilla", { productId: "1", productName: "Vanilla" }]]);
  assert.equal(filterAnalyticsOrders([order], { machine: "123", payType: "Card", product: "vanilla" }, aliases).length, 1);
});
