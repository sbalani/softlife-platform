import assert from "node:assert/strict";
import test from "node:test";
import { analyticsPresetRange, analyticsRange, canonicalProductCombination, filterAnalyticsOrders, machineSalesReport, salesTimeBreakdown, toppingConsumption } from "./analytics.ts";
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
    machine: "Madrid", machineId: "", imei: "123", orders: 1, units: 2, gross: 7.5, refundedOrders: 1, refunded: 3, net: 4.5,
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
  const order = { machine_id: "machine-1", device_imei: "123", pay_type: "Card", products: [], product_name: "Old Vanilla" } as unknown as Order;
  const aliases = new Map([["old vanilla", { productId: "1", productName: "Vanilla" }]]);
  assert.equal(filterAnalyticsOrders([order], { machineId: "machine-1", payType: "Card", product: "vanilla" }, aliases).length, 1);
  assert.equal(filterAnalyticsOrders([order], { machineId: "machine-2" }, aliases).length, 0);
});

test("hourly sales compare weekday occurrences with the all-days average", () => {
  const orders = [
    { order_time: "2026-08-03T08:00:00Z", price: 10 },
    { order_time: "2026-08-10T08:00:00Z", price: 30 },
    { order_time: "2026-08-04T08:00:00Z", price: 9 },
  ] as unknown as Order[];
  const result = salesTimeBreakdown(orders, "2026-08-03", 9, "UTC");

  assert.equal(result.hourly.length, 24);
  assert.deepEqual(result.weekdays.slice(0, 2).map((weekday) => weekday.occurrences), [2, 2]);
  assert.equal(result.hourly[8].weekdayAverages[0], 20);
  assert.equal(result.hourly[8].weekdayAverages[1], 4.5);
  assert.equal(result.hourly[8].allDaysAverage, 49 / 9);
  assert.equal(result.hourly[7].allDaysAverage, 0);
});

test("hourly sales use the configured local weekday and hour", () => {
  const orders = [
    { order_time: "2026-08-02T21:59:00Z", price: 99 },
    { order_time: "2026-08-02T22:30:00Z", price: 12 },
    { order_time: "2026-08-03T22:00:00Z", price: 99 },
  ] as unknown as Order[];
  const result = salesTimeBreakdown(orders, "2026-08-03", 1, "Europe/Madrid");

  assert.equal(result.hourly[0].allDaysAverage, 12);
  assert.equal(result.hourly[0].weekdayAverages[0], 12);
  assert.equal(result.heatmap[0][0], 12);
});

test("analytics payout presets use inclusive Madrid calendar periods", () => {
  const now = new Date("2026-08-21T12:00:00Z");
  assert.deepEqual(analyticsPresetRange("today", "Europe/Madrid", now), { from: "2026-08-21", to: "2026-08-21" });
  assert.deepEqual(analyticsPresetRange("yesterday", "Europe/Madrid", now), { from: "2026-08-20", to: "2026-08-20" });
  assert.deepEqual(analyticsPresetRange("this-week", "Europe/Madrid", now), { from: "2026-08-17", to: "2026-08-21" });
  assert.deepEqual(analyticsPresetRange("last-week", "Europe/Madrid", now), { from: "2026-08-10", to: "2026-08-16" });
  assert.deepEqual(analyticsPresetRange("this-month", "Europe/Madrid", now), { from: "2026-08-01", to: "2026-08-21" });
  assert.deepEqual(analyticsPresetRange("last-month", "Europe/Madrid", now), { from: "2026-07-01", to: "2026-07-31" });
});

test("topping consumption includes solid and liquid servings but excludes bases, legacy unknowns and refunds", () => {
  const common = { order_state: "COMPLETE", is_admin_override: false, refund_status: null };
  const orders = [
    { ...common, nums: 2, products: [{ goodsName: "Vanilla", position: 1 }, { goodsName: "oreo", position: 2 }, { goodsName: "Nuts", position: 3 }, { goodsName: "Sauce", position: 5 }], product_name: "Combo" },
    { ...common, nums: 1, products: [{ goodsName: "Oreo", position: 2 }], product_name: "Oreo" },
    { ...common, nums: 10, refund_status: "Refunded", products: [{ goodsName: "Oreo", position: 2 }], product_name: "Oreo" },
    { ...common, nums: 10, products: [], product_name: "Legacy base" },
  ] as unknown as Order[];
  const aliases = new Map([
    ["oreo", { productId: "1", productName: "Oreo", productType: "topping" }],
    ["sauce", { productId: "2", productName: "Chocolate sauce", productType: "sauce" }],
  ]);
  assert.deepEqual(toppingConsumption(orders, aliases), [
    { name: "Oreo", servings: 3, orders: 2 },
    { name: "Chocolate sauce", servings: 2, orders: 1 },
    { name: "Nuts", servings: 2, orders: 1 },
  ]);
});

test("topping consumption accepts Huaxin solid and liquid lanes while excluding catalog bases", () => {
  const order = {
    order_state: "COMPLETE", is_admin_override: false, refund_status: null, nums: 2, product_name: "Combo",
    products: [{ goodsName: "Oreo", position: 2 }, { goodsName: "Avellana", position: 5 }, { goodsName: "Vanilla", position: 3 }],
  } as unknown as Order;
  const aliases = new Map([
    ["oreo", { productId: "topping-1", productName: "Galleta OREO", productType: "topping" }],
    ["avellana", { productId: "wrong-type", productName: "Avellana", productType: "topping" }],
    ["vanilla", { productId: "base-1", productName: "Soft Vainilla Nata", productType: "base" }],
  ]);
  assert.deepEqual(toppingConsumption([order], aliases), [
    { name: "Avellana", servings: 2, orders: 1 },
    { name: "Galleta OREO", servings: 2, orders: 1 },
  ]);
});

test("topping consumption can use solid and liquid catalog types when legacy positions are unavailable", () => {
  const order = {
    order_state: "COMPLETE", is_admin_override: false, refund_status: null, nums: 1, product_name: "Combo",
    products: [{ goodsName: "Oreo", position: Number.NaN }, { goodsName: "Caramel", position: Number.NaN }, { goodsName: "Unknown", position: Number.NaN }],
  } as unknown as Order;
  const aliases = new Map([
    ["oreo", { productId: "topping-1", productName: "Galleta OREO", productType: "topping" }],
    ["caramel", { productId: "sauce-1", productName: "Caramelo", productType: "sauce" }],
  ]);
  assert.deepEqual(toppingConsumption([order], aliases), [
    { name: "Caramelo", servings: 1, orders: 1 },
    { name: "Galleta OREO", servings: 1, orders: 1 },
  ]);
});

test("topping consumption counts repeated topping entries as multiple servings in one order", () => {
  const order = {
    order_state: "COMPLETE", is_admin_override: false, refund_status: null, nums: 2, product_name: "Double Oreo",
    products: [{ goodsName: "Oreo", position: 2 }, { goodsName: "Oreo", position: 2 }, { goodsName: "Caramel", position: 5 }],
  } as unknown as Order;
  const aliases = new Map([
    ["oreo", { productId: "topping-1", productName: "Galleta OREO", productType: "topping" }],
    ["caramel", { productId: "sauce-1", productName: "Caramelo", productType: "sauce" }],
  ]);
  assert.deepEqual(toppingConsumption([order], aliases), [
    { name: "Galleta OREO", servings: 4, orders: 1 },
    { name: "Caramelo", servings: 2, orders: 1 },
  ]);
});

test("machine sales reports keep one stable machine across IMEI changes", () => {
  const orders = [
    { machine_id: "machine-1", order_time: "2026-08-05T10:00:00Z", order_state: "COMPLETE", is_admin_override: false, refund_status: null, device_imei: "old", machine_name: "Madrid", price: 5, nums: 1 },
    { machine_id: "machine-1", order_time: "2026-08-05T11:00:00Z", order_state: "COMPLETE", is_admin_override: false, refund_status: null, device_imei: "new", machine_name: "Madrid", price: 6, nums: 1 },
  ] as unknown as Order[];
  const rows = machineSalesReport(orders, "weekly", "Europe/Madrid");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].machineId, "machine-1");
  assert.equal(rows[0].net, 11);
});

test("product combinations are canonical regardless of source order", () => {
  const aliases = new Map<string, { productId: string; productName: string }>();
  const first = { products: [{ goodsName: "Oreo" }, { goodsName: "Nuts" }], product_name: "" } as unknown as Order;
  const second = { products: [{ goodsName: "Nuts" }, { goodsName: "Oreo" }], product_name: "" } as unknown as Order;
  assert.equal(canonicalProductCombination(first, aliases), canonicalProductCombination(second, aliases));
  const incomplete = { products: [{}, { goodsName: "Oreo" }], product_name: "" } as unknown as Order;
  assert.equal(canonicalProductCombination(incomplete, aliases), "Oreo");
});
