import assert from "node:assert/strict";
import test from "node:test";
import { analyticsRange, filterAnalyticsOrders, machineSalesReport } from "./analytics.ts";
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

test("machine sales reports group local weeks and exclude refunds from net sales", () => {
  const orders = [
    { order_time: "2026-08-02T22:30:00Z", order_state: "COMPLETE", is_admin_override: false, refund_status: null, device_imei: "123", machine_name: "Madrid", price: 4.5, nums: 2 },
    { order_time: "2026-08-04T10:00:00Z", order_state: "COMPLETE", is_admin_override: false, refund_status: "Refunded", device_imei: "123", machine_name: "Madrid", price: 3, nums: 1 },
    { order_time: "2026-08-04T11:00:00Z", order_state: "COMPLETE", is_admin_override: true, refund_status: null, device_imei: "123", machine_name: "Madrid", price: 99, nums: 1 },
  ] as unknown as Order[];
  assert.deepEqual(machineSalesReport(orders, "weekly", "Europe/Madrid"), [{
    period: "2026-08-03 to 2026-08-09", periodStart: "2026-08-03", periodEnd: "2026-08-09",
    dataFrom: "2026-08-03", dataTo: "2026-08-09", partial: false,
    machine: "Madrid", imei: "123", orders: 1, units: 2, gross: 7.5, refundedOrders: 1, refunded: 3, net: 4.5,
  }]);
});

test("machine sales reports identify partial boundary periods", () => {
  const orders = [{ order_time: "2026-08-05T10:00:00Z", order_state: "COMPLETE", is_admin_override: false, refund_status: null, device_imei: "123", machine_name: "Madrid", price: 5, nums: 1 }] as unknown as Order[];
  const row = machineSalesReport(orders, "weekly", "Europe/Madrid", "2026-08-05", "2026-08-06")[0];
  assert.deepEqual({ dataFrom: row.dataFrom, dataTo: row.dataTo, partial: row.partial }, { dataFrom: "2026-08-05", dataTo: "2026-08-06", partial: true });
});

test("machine sales reports group calendar months", () => {
  const orders = [{ order_time: "2026-08-31T22:30:00Z", order_state: "COMPLETE", is_admin_override: false, refund_status: null, device_imei: "123", machine_name: "Madrid", price: 5, nums: 1 }] as unknown as Order[];
  assert.equal(machineSalesReport(orders, "monthly", "Europe/Madrid")[0]?.period, "2026-09");
});

test("analytics filters resolve product aliases", () => {
  const order = { device_imei: "123", pay_type: "Card", products: [], product_name: "Old Vanilla" } as unknown as Order;
  const aliases = new Map([["old vanilla", { productId: "1", productName: "Vanilla" }]]);
  assert.equal(filterAnalyticsOrders([order], { machine: "123", payType: "Card", product: "vanilla" }, aliases).length, 1);
});
