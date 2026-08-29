import assert from "node:assert/strict";
import test from "node:test";
import { filterOrdersByMachinePeriods, machinePeriodTenantScope } from "../machine-access.ts";
import type { Order } from "./orders.ts";

test("historical analytics include orders only inside the franchisee assignment interval", () => {
  const orders = [
    { machine_id: "machine-1", order_time: "2026-07-31T10:00:00Z" },
    { machine_id: "machine-1", order_time: "2026-08-01T10:00:00Z" },
    { machine_id: "machine-1", order_time: "2026-08-31T22:30:00Z" },
    { machine_id: "machine-2", order_time: "2026-08-15T10:00:00Z" },
  ] as unknown as Order[];
  const filtered = filterOrdersByMachinePeriods(orders, [{ machine_id: "machine-1", start_date: "2026-08-01", end_date: "2026-08-31" }], "Europe/Madrid");
  assert.deepEqual(filtered.map((order) => order.order_time), ["2026-08-01T10:00:00Z"]);
});

test("admins retain all orders and users with no assignments retain none", () => {
  const orders = [{ machine_id: "machine-1", order_time: "2026-08-01T10:00:00Z" }] as unknown as Order[];
  assert.equal(filterOrdersByMachinePeriods(orders, null, "UTC").length, 1);
  assert.equal(filterOrdersByMachinePeriods(orders, [], "UTC").length, 0);
});

test("admins without a tenant retain access to every machine", () => {
  assert.equal(machinePeriodTenantScope({ role: "admin", tenant_id: null }), null);
  assert.equal(machinePeriodTenantScope({ role: "franchisee", tenant_id: null }), undefined);
  assert.equal(machinePeriodTenantScope({ role: "franchisee", tenant_id: "tenant-1" }), "tenant-1");
});
