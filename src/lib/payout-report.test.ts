import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import type { Order } from "./data/orders.ts";
import { authorizePayoutTenant, calculatePayoutIva, calculatePayoutRows, createPayoutPdf, payoutBankDetailLines, payoutTaxBreakdown, validPayoutRange, type PayoutAssignment } from "./payout-report.ts";
import { createPayoutArchive } from "./payout-archive.ts";

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
  assert.deepEqual(payoutTaxBreakdown(rows[0].payout), { base: 2.07, iva: 0.43, total: 2.5 });
  assert.equal(calculatePayoutIva(rows[0].payout), 0.43);
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

test("range validation and payout PDFs without bank details work", async () => {
  assert.equal(validPayoutRange("2026-07-01", "2026-07-31"), true);
  assert.equal(validPayoutRange("2026-07-31", "2026-07-01"), false);
  assert.equal(validPayoutRange("invalid", "2026-07-31"), false);
  assert.equal(validPayoutRange("2026-99-99", "2026-07-31"), false);
  assert.equal(validPayoutRange("2025-01-01", "2026-07-31"), false);
  const bytes = await createPayoutPdf({ franchiseeName: "Madrid Foods 🍦", from: "2026-07-01", to: "2026-07-31", rows: [], bankDetails: null });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), "%PDF-");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("bank details are formatted only when supplied to a payout statement", async () => {
  assert.deepEqual(payoutBankDetailLines(null), []);
  const bankDetails = { accountHolderName: "Madrid Foods SL", iban: "ES9121000418450200051332", bicSwift: "CAIXESBBXXX", bankName: "CaixaBank" };
  assert.deepEqual(payoutBankDetailLines(bankDetails), ["Account holder: Madrid Foods SL", "IBAN: ES9121000418450200051332", "BIC/SWIFT: CAIXESBBXXX", "Bank: CaixaBank"]);
  const bytes = await createPayoutPdf({ franchiseeName: "Madrid Foods", from: "2026-07-01", to: "2026-07-31", rows: [], bankDetails });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), "%PDF-");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("bulk payout archives contain separate PDFs and a manifest", async () => {
  const bytes = await createPayoutArchive({
    from: "2026-07-01", to: "2026-07-31", bankDetailsRequested: true,
    reports: [
      { tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tenantName: "Madrid Foods", rows: [], total: 2.5, bankDetails: null },
      { tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenantName: "Madrid Foods", rows: [], total: 3.5, bankDetails: null },
    ],
  });
  const files = unzipSync(bytes);
  const names = Object.keys(files).sort();
  assert.deepEqual(names, [
    "manifest.csv",
    "payout-madrid-foods-aaaaaaaa-2026-07-01-2026-07-31.pdf",
    "payout-madrid-foods-bbbbbbbb-2026-07-01-2026-07-31.pdf",
  ]);
  assert.equal(String.fromCharCode(...files[names[1]].slice(0, 5)), "%PDF-");
  const manifest = strFromU8(files["manifest.csv"]);
  assert.match(manifest, /Madrid Foods,2.50,unavailable/);
  assert.match(manifest, /Madrid Foods,3.50,unavailable/);
});
