import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFiscalPreflightItem,
  evaluateFiscalConfiguration,
  fiscalCsvCell,
  fiscalGrossBreakdown,
  operationLocalDate,
  summarizeFiscalPreflight,
  type FiscalSettings,
} from "./odoo-fiscal-preflight.ts";

const settings: FiscalSettings = {
  journal_code: "VEND",
  customer_odoo_id: 722,
  vat_rate: 10,
  currency: "EUR",
  income_account_code: "701000",
  tax_treatment_approved: false,
  posting_enabled: false,
};

const configuration = {
  contract_version: 1,
  checked_at: "2026-09-29T12:00:00Z",
  company: { country_code: "ES", vat: "ESB12345678", currency: "EUR" },
  journal: { code: "VEND", type: "sale", refund_sequence: true, secure_posted_entries: false },
  customer: { odoo_id: 722, country_code: "ES", vat: null },
  tax: { odoo_id: 41, type_tax_use: "sale", rate: 10 },
  products: [{ odoo_product_id: 101, sale_ok: true, income_account_code: "701000", sale_tax_rates: [10] }],
};

const baseOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  order_code: "SALE-1",
  out_trade_no: "PAY-1",
  order_state: "3",
  status_code: "COMPLETE",
  order_time: "2026-03-29T22:15:00.000Z",
  pay_time: "2026-03-29T22:15:05.000Z",
  price: 3.8,
  nums: 1,
  product_name: "Frozen yogurt",
  products: [{ goodsName: "Frozen yogurt" }],
  pay_type_raw: "刷卡",
  refund_status: "0",
  refund_out_no: null,
  currency: "EUR",
  machine_id: "machine-1",
  device_imei: "imei-1",
};

function item(overrides: Record<string, unknown> = {}) {
  return buildFiscalPreflightItem({
    order: { ...baseOrder, ...overrides },
    resolutions: [{ line_index: 0, raw_name: "Frozen yogurt", raw_position: null, resolution_status: "resolved", recipe_id: "recipe-1" }],
    recipes: new Map([["recipe-1", { id: "recipe-1", name: "Frozen yogurt", odoo_finished_product_id: 101 }]]),
    settings,
    timeZone: "Europe/Madrid",
    duplicatePaymentReference: false,
    verifiedProducts: new Map([[101, { odoo_product_id: 101, sale_ok: true, income_account_code: "701000", sale_tax_rates: [10] }]]),
  });
}

test("evaluates a complete Odoo configuration while preserving the journal-hash warning", () => {
  const result = evaluateFiscalConfiguration(settings, configuration);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.findings.map((finding) => finding.code), ["journal_hash_disabled"]);
  assert.equal(result.products[0].odoo_product_id, 101);
});

test("blocks an Odoo configuration with the wrong tax and income setup", () => {
  const result = evaluateFiscalConfiguration(settings, {
    ...configuration,
    tax: { odoo_id: 41, type_tax_use: "sale", rate: 21 },
    products: [{ odoo_product_id: 101, sale_ok: true, income_account_code: "700000", sale_tax_rates: [21] }],
  });
  assert.equal(result.accepted, false);
  assert(result.findings.some((finding) => finding.code === "sales_tax_rate_mismatch"));
});

test("blocks an Odoo configuration with no numeric sales tax rate", () => {
  for (const rate of [null, "not-a-rate"]) {
    const result = evaluateFiscalConfiguration(settings, { ...configuration, tax: { odoo_id: 41, type_tax_use: "sale", rate } });
    assert.equal(result.accepted, false);
    assert(result.findings.some((finding) => finding.code === "sales_tax_rate_mismatch"));
  }
});

test("calculates included 10 percent VAT deterministically in cents", () => {
  assert.deepEqual(fiscalGrossBreakdown(3.8, 10), { grossCents: 380, baseCents: 345, vatCents: 35 });
  assert.deepEqual(fiscalGrossBreakdown("10.075", 10), { grossCents: 1008, baseCents: 916, vatCents: 92 });
  assert.equal(fiscalGrossBreakdown(0, 10), null);
});

test("blocks sales above the vending simplified-invoice control limit", () => {
  const result = item({ price: 3000.01 });
  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "simplified_invoice_limit_exceeded"));
});

test("uses the Madrid operation day across daylight-saving time", () => {
  assert.equal(operationLocalDate("2026-03-29T22:15:00.000Z", "Europe/Madrid"), "2026-03-30");
});

test("builds an eligible immutable source item", () => {
  const result = item();
  assert.equal(result.status, "eligible");
  assert.equal(result.operation_local_date, "2026-03-30");
  assert.equal(result.gross_cents, 380);
  assert.equal(result.tax_base_cents, 345);
  assert.equal(result.vat_cents, 35);
  assert.match(result.source_sha256, /^[0-9a-f]{64}$/);
});

test("excludes administrative operations and blocks unresolved sale lines", () => {
  assert.equal(item({ pay_type_raw: "自动制作" }).status, "excluded");
  const unresolved = buildFiscalPreflightItem({
    order: baseOrder,
    resolutions: [{ line_index: 0, raw_name: "Frozen yogurt", raw_position: null, resolution_status: "pending", recipe_id: null }],
    recipes: new Map(), settings, timeZone: "Europe/Madrid", duplicatePaymentReference: false, verifiedProducts: null,
  });
  assert.equal(unresolved.status, "blocked");
  assert(unresolved.findings.some((finding) => finding.code === "missing_product_resolution"));
});

test("blocks stale product resolutions and missing operation timestamps", () => {
  const stale = buildFiscalPreflightItem({
    order: baseOrder,
    resolutions: [{ line_index: 0, raw_name: "Old product", raw_position: null, resolution_status: "resolved", recipe_id: "recipe-1" }],
    recipes: new Map([["recipe-1", { id: "recipe-1", name: "Frozen yogurt", odoo_finished_product_id: 101 }]]),
    settings, timeZone: "Europe/Madrid", duplicatePaymentReference: false, verifiedProducts: null,
  });
  assert.equal(stale.status, "blocked");
  assert(stale.findings.some((finding) => finding.code === "stale_product_resolution"));
  const missingTime = item({ order_time: null, pay_time: "2026-03-29T22:15:05.000Z" });
  assert.equal(missingTime.status, "blocked");
  assert(missingTime.findings.some((finding) => finding.code === "missing_operation_time"));
});

test("neutralizes spreadsheet formulas in CSV cells", () => {
  assert.equal(fiscalCsvCell("=HYPERLINK(\"bad\")"), '"\'=HYPERLINK(""bad"")"');
  assert.equal(fiscalCsvCell("normal"), '"normal"');
});

test("flags refunded sales for credit-note review without changing the gross invoice", () => {
  const result = item({ refund_status: "1", refund_out_no: "REFUND-1" });
  assert.equal(result.status, "eligible");
  assert.equal(result.refund_required, true);
  assert(result.findings.some((finding) => finding.code === "refund_requires_review"));
  assert.deepEqual(summarizeFiscalPreflight([result]), {
    selected_orders: 1, eligible_invoices: 1, blocked_orders: 0, excluded_orders: 0,
    refunds_requiring_review: 1, warning_findings: 1, gross_cents: 380, tax_base_cents: 345, vat_cents: 35,
  });
});
