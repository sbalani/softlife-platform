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
import { buildFiscalRemediationPreview } from "./odoo-fiscal-remediation.ts";
import { sha256 } from "./odoo-sync-contract.ts";

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
  capabilities: { fiscal_zero_value_invoices: 2 },
  company: { country_code: "ES", vat: "ESB12345678", currency: "EUR" },
  journal: { code: "VEND", type: "sale", refund_sequence: true, secure_posted_entries: false },
  customer: { odoo_id: 722, country_code: "ES", vat: null },
  tax: { odoo_id: 41, type_tax_use: "sale", amount_type: "percent", rate: 10, country_code: "ES", price_include: true },
  products: [{ odoo_product_id: 101, sale_ok: true, income_account_code: "701000", sale_tax_rates: [10], sale_tax_country_codes: ["ES"], sale_tax_ids: [41], sale_taxes: [{ odoo_tax_id: 41, rate: 10, country_code: "ES", price_include: true, amount_type: "percent", type_tax_use: "sale" }] }],
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
    verifiedProducts: new Map([[101, { odoo_product_id: 101, sale_ok: true, income_account_code: "701000", sale_tax_rates: [10], sale_tax_country_codes: ["ES"], sale_taxes: [{ odoo_tax_id: 41, rate: 10, country_code: "ES", price_include: true, amount_type: "percent", type_tax_use: "sale" }] }]]),
  });
}

test("evaluates a complete Odoo configuration with a standard sales journal", () => {
  const result = evaluateFiscalConfiguration(settings, configuration);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.products[0].odoo_product_id, 101);
});

test("continues accepting the version 1 zero-value capability during rollout", () => {
  const result = evaluateFiscalConfiguration(settings, {
    ...configuration,
    capabilities: { fiscal_zero_value_invoices: 1 },
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.findings, []);
});

test("blocks an Odoo configuration with the wrong tax and income setup", () => {
  const result = evaluateFiscalConfiguration(settings, {
    ...configuration,
    tax: { odoo_id: 41, type_tax_use: "sale", amount_type: "percent", rate: 21, country_code: "ES", price_include: true },
    products: [{ odoo_product_id: 101, sale_ok: true, income_account_code: "700000", sale_tax_rates: [21], sale_tax_country_codes: ["ES"], sale_tax_ids: [41], sale_taxes: [{ odoo_tax_id: 41, rate: 21, country_code: "ES", price_include: true, amount_type: "percent", type_tax_use: "sale" }] }],
  });
  assert.equal(result.accepted, false);
  assert(result.findings.some((finding) => finding.code === "sales_tax_rate_mismatch"));
});

test("blocks an Odoo configuration with no numeric sales tax rate", () => {
  for (const rate of [null, "not-a-rate"]) {
    const result = evaluateFiscalConfiguration(settings, { ...configuration, tax: { odoo_id: 41, type_tax_use: "sale", rate, country_code: "ES" } });
    assert.equal(result.accepted, false);
    assert(result.findings.some((finding) => finding.code === "sales_tax_rate_mismatch"));
  }
});

test("blocks a fixed-amount tax that happens to have amount 10", () => {
  const result = evaluateFiscalConfiguration(settings, {
    ...configuration,
    tax: { ...configuration.tax, amount_type: "fixed" },
  });
  assert.equal(result.accepted, false);
  assert(result.findings.some((finding) => finding.code === "sales_tax_invalid"));
});

test("blocks a non-Spanish global sales tax", () => {
  const result = evaluateFiscalConfiguration(settings, {
    ...configuration,
    tax: { odoo_id: 41, type_tax_use: "sale", rate: 10, country_code: "FR" },
    products: [{ ...configuration.products[0], sale_tax_country_codes: ["FR"] }],
  });
  assert.equal(result.accepted, false);
  assert(result.findings.some((finding) => finding.code === "sales_tax_country_invalid"));
});

test("blocks a product whose matching-rate tax is not Spanish", () => {
  const result = buildFiscalPreflightItem({
    order: baseOrder,
    resolutions: [{ line_index: 0, raw_name: "Frozen yogurt", raw_position: null, resolution_status: "resolved", recipe_id: "recipe-1" }],
    recipes: new Map([["recipe-1", { id: "recipe-1", name: "Frozen yogurt", odoo_finished_product_id: 101 }]]),
    settings, timeZone: "Europe/Madrid", duplicatePaymentReference: false,
    verifiedProducts: new Map([[101, {
      odoo_product_id: 101, sale_ok: true, income_account_code: "701000",
      sale_tax_rates: [10, 21], sale_tax_country_codes: ["FR", "ES"],
      sale_taxes: [
        { odoo_tax_id: 41, rate: 10, country_code: "FR", price_include: true, amount_type: "percent", type_tax_use: "sale" },
        { odoo_tax_id: 42, rate: 21, country_code: "ES", price_include: true, amount_type: "percent", type_tax_use: "sale" },
      ],
    }]]),
  });
  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "product_tax_mismatch"));
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

test("invoices free, administrative, and coupon vends at zero while blocking invalid paid totals", () => {
  for (const payType of ["免费", "Free", " Free ", "自动制作", "Admin override", "串码支付", "Coupon"]) {
    const result = item({ pay_type_raw: payType, price: payType === "免费" ? 0 : 3.8 });
    assert.equal(result.status, "eligible");
    assert.equal(result.gross_cents, 0);
    assert.equal(result.tax_base_cents, 0);
    assert.equal(result.vat_cents, 0);
    assert.equal(result.source_snapshot.price, payType === "免费" ? 0 : 3.8);
    assert(result.findings.some((finding) => finding.code === "zero_value_vend"));
  }
  const paidZero = item({ pay_type_raw: "刷卡", price: 0 });
  assert.equal(paidZero.status, "blocked");
  assert(paidZero.findings.some((finding) => finding.code === "invalid_gross_total"));
});

test("blocks unresolved sale lines", () => {
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

test("builds a sorted remediation payload from the same effective product checks", () => {
  const now = Date.now();
  const reportPayload = {
    ...configuration,
    checked_at: new Date(now - 60_000).toISOString(),
    capabilities: { fiscal_product_remediation: 1, fiscal_zero_value_invoices: 2 },
    company: { ...configuration.company, odoo_id: 3 },
    income_account: { odoo_id: 77, code: "701000", account_type: "income" },
    products: [
      { ...configuration.products[0], odoo_product_id: 202, income_account_code: "700000" },
      { ...configuration.products[0], odoo_product_id: 101, sale_taxes: [] },
    ],
  };
  const preview = buildFiscalRemediationPreview({
    settings,
    now,
    report: { id: "11111111-1111-4111-8111-111111111111", checked_at: reportPayload.checked_at, accepted: true, payload_sha256: sha256(reportPayload), payload: reportPayload },
    recipes: [
      { name: "Second", odoo_finished_product_id: 202 },
      { name: "First", odoo_finished_product_id: 101 },
      { name: "First alias", odoo_finished_product_id: 101 },
    ],
  });
  assert.deepEqual(preview.blockers, []);
  assert.deepEqual(preview.payload?.products, [
    { odoo_product_id: 101, remediate_income_account: false, remediate_customer_taxes: true },
    { odoo_product_id: 202, remediate_income_account: true, remediate_customer_taxes: false },
  ]);
  assert.deepEqual(preview.products[0].names, ["First", "First alias"]);
  assert.match(preview.payloadSha256 ?? "", /^[0-9a-f]{64}$/);
});

test("shows missing reported recipe products and blocks remediation", () => {
  const now = Date.now();
  const payload = {
    ...configuration,
    checked_at: new Date(now - 60_000).toISOString(),
    capabilities: { fiscal_product_remediation: 1, fiscal_zero_value_invoices: 2 },
    company: { ...configuration.company, odoo_id: 3 },
    income_account: { odoo_id: 77, code: "701000", account_type: "income" },
    products: [{ ...configuration.products[0], income_account_code: "700000" }],
  };
  const preview = buildFiscalRemediationPreview({
    settings, now,
    report: { id: "11111111-1111-4111-8111-111111111111", checked_at: payload.checked_at, accepted: true, payload_sha256: sha256(payload), payload },
    recipes: [{ name: "Reported", odoo_finished_product_id: 101 }, { name: "Missing", odoo_finished_product_id: 303 }],
  });
  assert.deepEqual(preview.missingProducts, [{ odoo_product_id: 303, names: ["Missing"] }]);
  assert.equal(preview.products.length, 1);
  assert.equal(preview.payload, null);
  assert(preview.blockers.some((blocker) => blocker.includes("missing")));
});

test("blocks stale, incapable, invalid-target, and active remediation previews", () => {
  const now = Date.now();
  const payload = {
    ...configuration,
    checked_at: new Date(now - 25 * 60 * 60_000).toISOString(),
    capabilities: {},
    company: { ...configuration.company, odoo_id: null },
    income_account: { odoo_id: null, code: "700000", account_type: "asset_current" },
    products: [{ ...configuration.products[0], income_account_code: "700000" }],
  };
  const preview = buildFiscalRemediationPreview({
    settings, now,
    report: { id: "11111111-1111-4111-8111-111111111111", checked_at: payload.checked_at, accepted: true, payload_sha256: sha256(payload), payload },
    recipes: [{ name: "Reported", odoo_finished_product_id: 101 }],
    latestRequest: { id: "request", status: "processing", requested_at: payload.checked_at, claimed_at: null, completed_at: null, attempts: 1, result: null, error: null },
  });
  assert.equal(preview.payload, null);
  assert(preview.blockers.some((blocker) => blocker.includes("24 hours")));
  assert(preview.blockers.some((blocker) => blocker.includes("capability")));
  assert(preview.blockers.some((blocker) => blocker.includes("income account")));
  assert(preview.blockers.some((blocker) => blocker.includes("already active")));
});
