import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFiscalInvoiceConfirmationPayload,
  buildFiscalInvoiceDraftPayload,
  canonicalFiscalPayload,
  fiscalCalendarMonth,
  validateFiscalInvoiceResult,
  type FiscalInvoiceSourceItem,
} from "./odoo-fiscal-invoices.ts";
import { sha256 } from "./odoo-sync-contract.ts";

const item: FiscalInvoiceSourceItem = {
  id: "11111111-1111-4111-8111-111111111111",
  order_id: "22222222-2222-4222-8222-222222222222",
  operation_local_date: "2026-09-03",
  order_code: "SALE-1",
  payment_reference: "PAY-1",
  description: "Frozen yogurt",
  units: 1,
  gross_cents: 380,
  tax_base_cents: 345,
  vat_cents: 35,
  odoo_product_id: 101,
  refund_required: false,
  source_sha256: "a".repeat(64),
};

function draft() {
  const now = Date.parse("2026-09-29T13:00:00Z");
  const configuration = {
    contract_version: 1,
    checked_at: "2026-09-29T12:00:00Z",
    capabilities: { fiscal_invoice_draft_creation: 1, fiscal_invoice_bulk_confirmation: 1 },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" },
    journal: { code: "VEND" },
    customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: true },
  };
  return buildFiscalInvoiceDraftPayload({
    now,
    report: { id: "33333333-3333-4333-8333-333333333333", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [item],
    platformInvoiceIds: ["44444444-4444-4444-8444-444444444444"],
  });
}

test("builds canonical draft and per-invoice hashes without hashing the hash field", () => {
  const result = draft();
  assert.deepEqual(result.blockers, []);
  assert(result.payload);
  const invoice = result.payload.invoices[0];
  const { invoice_payload_sha256: invoiceHash, ...unhashed } = invoice;
  assert.equal(invoiceHash, sha256(unhashed));
  assert.equal(result.payloadSha256, sha256(result.payload));
  assert.equal(canonicalFiscalPayload({ z: 1, a: 2 }), '{"a":2,"z":1}');
  assert.deepEqual(invoice.lines, [{ odoo_product_id: 101, description: "Frozen yogurt", quantity: 1, gross_cents: 380, tax_base_cents: 345, vat_cents: 35, odoo_tax_id: 41 }]);
});

test("preserves excluded-price Odoo tax configuration without forcing price inclusion", () => {
  const now = Date.parse("2026-09-29T13:00:00Z");
  const configuration = {
    contract_version: 1, checked_at: "2026-09-29T12:00:00Z",
    capabilities: { fiscal_invoice_draft_creation: 1, fiscal_invoice_bulk_confirmation: 1 },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" }, journal: { code: "VEND" },
    customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: false },
  };
  const result = buildFiscalInvoiceDraftPayload({
    now, report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [item], platformInvoiceIds: ["invoice"],
  });
  assert.equal(result.payload?.tax.price_include, false);
});

test("normalizes accepted report text and requires an explicit tax price mode", () => {
  const reportPayload = {
    contract_version: 1, checked_at: "2026-09-29T12:00:00Z",
    capabilities: { fiscal_invoice_draft_creation: 1, fiscal_invoice_bulk_confirmation: 1 },
    company: { odoo_id: 3, country_code: " es ", currency: " eur " },
    journal: { code: " vend " }, customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: " es ", type_tax_use: " sale ", amount_type: " percent ", price_include: true },
  };
  const normalized = buildFiscalInvoiceDraftPayload({
    now: Date.parse("2026-09-29T13:00:00Z"),
    report: { id: "report", checked_at: reportPayload.checked_at, accepted: true, payload_sha256: sha256(reportPayload), payload: reportPayload },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [item], platformInvoiceIds: ["invoice"],
  });
  assert.deepEqual(normalized.payload?.company, { odoo_id: 3, country_code: "ES", currency: "EUR" });
  assert.equal(normalized.payload?.journal.code, "VEND");
  assert.equal(normalized.payload?.tax.type_tax_use, "sale");

  const taxWithoutPriceMode: Record<string, unknown> = { ...reportPayload.tax };
  delete taxWithoutPriceMode.price_include;
  const invalidPayload = { ...reportPayload, tax: taxWithoutPriceMode };
  const invalid = buildFiscalInvoiceDraftPayload({
    now: Date.parse("2026-09-29T13:00:00Z"),
    report: { id: "report", checked_at: invalidPayload.checked_at, accepted: true, payload_sha256: sha256(invalidPayload), payload: invalidPayload },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [item], platformInvoiceIds: ["invoice"],
  });
  assert(invalid.blockers.some((message) => message.includes("price-inclusion")));
});

test("blocks stale, incapable, refund-warning, empty, and oversized draft sources", () => {
  const good = draft();
  assert(good.payload);
  const reportPayload = { ...good.payload, checked_at: "2026-09-27T00:00:00Z", capabilities: {} };
  const blocked = buildFiscalInvoiceDraftPayload({
    now: Date.parse("2026-09-29T13:00:00Z"),
    report: { id: "id", checked_at: "2026-09-27T00:00:00Z", accepted: true, payload_sha256: sha256(reportPayload), payload: reportPayload },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722,
    items: [{ ...item, refund_required: true }], platformInvoiceIds: ["id"],
  });
  assert.equal(blocked.payload, null);
  assert(blocked.blockers.some((message) => message.includes("stale")));
  assert(blocked.blockers.some((message) => message.includes("capabilities")));
  assert(blocked.blockers.some((message) => message.includes("Refund-warning")));
  const empty = buildFiscalInvoiceDraftPayload({
    now: Date.now(), report: { id: "id", checked_at: new Date().toISOString(), accepted: false, payload_sha256: "a".repeat(64), payload: {} },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [], platformInvoiceIds: [],
  });
  assert(empty.blockers.some((message) => message.includes("no eligible")));
  assert.throws(() => buildFiscalInvoiceConfirmationPayload(3, Array.from({ length: 501 }, (_, index) => ({ platform_invoice_id: String(index), odoo_move_id: index + 1, invoice_payload_sha256: "a".repeat(64) }))), /between 1 and 500/);
});

test("validates exact draft and confirmation response coverage", () => {
  const payload = draft().payload!;
  const invoice = payload.invoices[0];
  const acceptedDraft = { accepted: true, invoices: [{ platform_invoice_id: invoice.platform_invoice_id, odoo_move_id: 91, invoice_payload_sha256: invoice.invoice_payload_sha256, state: "draft", created: true }] };
  assert.doesNotThrow(() => validateFiscalInvoiceResult("fiscal_invoice_draft_creation", payload, acceptedDraft));
  assert.throws(() => validateFiscalInvoiceResult("fiscal_invoice_draft_creation", payload, { accepted: true, invoices: [] }), /cover/);
  assert.throws(() => validateFiscalInvoiceResult("fiscal_invoice_draft_creation", payload, { accepted: true, invoices: [acceptedDraft.invoices[0], acceptedDraft.invoices[0]] }), /cover|duplicate/);
  const confirmation = buildFiscalInvoiceConfirmationPayload(3, [{ platform_invoice_id: invoice.platform_invoice_id, odoo_move_id: 91, invoice_payload_sha256: invoice.invoice_payload_sha256 }]);
  assert.doesNotThrow(() => validateFiscalInvoiceResult("fiscal_invoice_bulk_confirmation", confirmation, { accepted: true, invoices: [{ ...confirmation.invoices[0], state: "posted", name: "VEND/2026/1", confirmed: true }] }));
  assert.throws(() => validateFiscalInvoiceResult("fiscal_invoice_bulk_confirmation", confirmation, { accepted: true, invoices: [{ ...confirmation.invoices[0], state: "draft", name: "", confirmed: false }] }), /posted invoice name/);
  assert.throws(() => validateFiscalInvoiceResult("fiscal_invoice_draft_creation", payload, { accepted: true, invoices: [{ ...acceptedDraft.invoices[0], state: "posted", name: "VEND\/2026\/1" }] }), /draft invoice/);
});

test("rejects duplicate Odoo moves in selections and connector results", () => {
  const payload = draft().payload!;
  const first = payload.invoices[0];
  const second = { ...first, platform_invoice_id: "55555555-5555-4555-8555-555555555555", invoice_payload_sha256: "b".repeat(64) };
  assert.throws(() => buildFiscalInvoiceConfirmationPayload(3, [
    { platform_invoice_id: first.platform_invoice_id, odoo_move_id: 91, invoice_payload_sha256: first.invoice_payload_sha256 },
    { platform_invoice_id: second.platform_invoice_id, odoo_move_id: 91, invoice_payload_sha256: second.invoice_payload_sha256 },
  ]), /distinct Odoo move IDs/);
  assert.throws(() => validateFiscalInvoiceResult("fiscal_invoice_draft_creation", { invoices: [first, second] }, {
    accepted: true,
    invoices: [
      { platform_invoice_id: first.platform_invoice_id, odoo_move_id: 91, invoice_payload_sha256: first.invoice_payload_sha256, state: "draft", created: true },
      { platform_invoice_id: second.platform_invoice_id, odoo_move_id: 91, invoice_payload_sha256: second.invoice_payload_sha256, state: "draft", created: true },
    ],
  }), /duplicate Odoo move ID/);
});

test("clips multi-day calendar spans to the selected month and retains status", () => {
  const calendar = fiscalCalendarMonth("2026-09", [
    { id: "a", local_date_from: "2026-08-30", local_date_to: "2026-09-02", status: "completed" },
    { id: "b", local_date_from: "2026-09-29", local_date_to: "2026-10-03", status: "draft_ready" },
  ]);
  assert.deepEqual(calendar.clippedSpans.map(({ id, visible_from, visible_to, status }) => ({ id, visible_from, visible_to, status })), [
    { id: "a", visible_from: "2026-09-01", visible_to: "2026-09-02", status: "completed" },
    { id: "b", visible_from: "2026-09-29", visible_to: "2026-09-30", status: "draft_ready" },
  ]);
  assert.equal(calendar.cells.find((cell) => cell?.date === "2026-09-01")?.spans[0].id, "a");
  assert.throws(() => fiscalCalendarMonth("2026-00", []), /Invalid calendar month/);
  assert.throws(() => fiscalCalendarMonth("2026-13", []), /Invalid calendar month/);
});
