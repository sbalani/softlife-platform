import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MACHINE_DETAIL_WIDGET_ORDER, normalizeMachineDetailWidgetOrder } from "./machine-detail-layout.ts";

test("the default machine template puts monitored status first", () => {
  assert.equal(DEFAULT_MACHINE_DETAIL_WIDGET_ORDER[0], "monitored_status");
});

test("saved machine widget order is deduplicated and completed", () => {
  const order = normalizeMachineDetailWidgetOrder(["sales", "monitored_status", "sales", "removed_widget"]);
  assert.deepEqual(order.slice(0, 2), ["sales", "monitored_status"]);
  assert.equal(order.length, DEFAULT_MACHINE_DETAIL_WIDGET_ORDER.length);
  assert.equal(new Set(order).size, order.length);
});
