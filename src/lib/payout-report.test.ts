import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import type { Order } from "./data/orders.ts";
import { authorizePayoutTenant, calculatePayoutRows, createPayoutPdf, validPayoutRange, type PayoutAssignment } from "./payout-report.ts";

const assignment = (overrides: Partial<PayoutAssignment> = {}): PayoutAssignment => ({
  id: "assignment-a", machine_id: "machine-a", tenant_id: "tenant-a", start_date: "2026-07-01", end_date: "2026-07-31",
  share_percent: 25, tenant_name: "Madrid Foods", machine_name: "Gran Via", device_imei: "new-imei", ...overrides,
});
const order = (overrides: Partial<Order> = {}) => ({
  machine_id: "machine-a", device_imei: "old-imei", order_time: "2026-06-30T22:30:00Z", create_time_utc: "2026-08-10T10:00:00Z",
  order_state: "COMPLETE", is_admin_override: false, refund_status: null, price: 11, ...overrides,
}) as Order;

test("payouts use Madrid order_time, stable machine IDs, effective VAT and clipped row periods", () => {
  const rows = calculatePayoutRows(
    [order()],
    [assignment()],
    [{ effective_from: "1970-01-01", rate_percent: 10 }],
    { from: "2026-07-01", to: "2026-07-15" },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period, "2026-07-01 to 2026-07-15");
  assert.equal(rows[0].orders, 1);
  assert.equal(rows[0].gross, 11);
  assert.ok(Math.abs(rows[0].net - 10) < 0.000001);
  assert.ok(Math.abs(rows[0].payout - 2.5) < 0.000001);
});

test("payouts internally exclude incomplete, admin and refunded orders", () => {
  const orders = [
    order({ order_state: "PENDING" }),
    order({ is_admin_override: true }),
    order({ refund_status: "Refunded" }),
    order({ machine_id: "machine-b" }),
  ];
  assert.deepEqual(calculatePayoutRows(orders, [assignment()], [], { from: "2026-07-01", to: "2026-07-31" }), []);
});

test("payout authorization only permits an admin selection or the franchisee's own tenant", () => {
  assert.deepEqual(authorizePayoutTenant(null, "tenant-a"), { allowed: false, status: 401 });
  assert.deepEqual(authorizePayoutTenant({ role: "operator", tenant_id: null }, "tenant-a"), { allowed: false, status: 403 });
  assert.deepEqual(authorizePayoutTenant({ role: "admin", tenant_id: null }, null), { allowed: false, status: 400 });
  assert.deepEqual(authorizePayoutTenant({ role: "admin", tenant_id: null }, "tenant-a"), { allowed: true, tenantId: "tenant-a" });
  assert.deepEqual(authorizePayoutTenant({ role: "franchisee", tenant_id: "tenant-a" }, "tenant-b"), { allowed: false, status: 403 });
  assert.deepEqual(authorizePayoutTenant({ role: "franchisee", tenant_id: "tenant-a" }, null), { allowed: true, tenantId: "tenant-a" });
});

test("range validation and empty PDF statements work", async () => {
  assert.equal(validPayoutRange("2026-07-01", "2026-07-31"), true);
  assert.equal(validPayoutRange("2026-07-31", "2026-07-01"), false);
  assert.equal(validPayoutRange("invalid", "2026-07-31"), false);
  assert.equal(validPayoutRange("2026-99-99", "2026-07-31"), false);
  assert.equal(validPayoutRange("2025-01-01", "2026-07-31"), false);
  const bytes = await createPayoutPdf({ franchiseeName: "Madrid Foods 🍦", from: "2026-07-01", to: "2026-07-31", rows: [] });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), "%PDF-");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});
