import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFiscalInvoiceConfirmationPayload,
  buildFiscalInvoiceDraftBatches,
  buildFiscalInvoiceDraftPayload,
  buildFiscalInvoiceDraftPayloadV2,
  closedFiscalMonth,
  canonicalFiscalPayload,
  fiscalV2WholeMonthBlocker,
  fiscalCalendarMonth,
  validateFiscalInvoiceResult,
  type FiscalInvoiceSourceItem,
  type FiscalInvoiceSourceItemV2,
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
  zero_value_reason: null,
};

function draft(source: FiscalInvoiceSourceItem = item, zeroValueCapability: number | null = 2) {
  const now = Date.parse("2026-09-29T13:00:00Z");
  const configuration = {
    contract_version: 1,
    checked_at: "2026-09-29T12:00:00Z",
    capabilities: {
      fiscal_invoice_draft_creation: 1,
      fiscal_invoice_bulk_confirmation: 1,
      ...(zeroValueCapability === null ? {} : { fiscal_zero_value_invoices: zeroValueCapability }),
    },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" },
    journal: { code: "VEND" },
    customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: true },
  };
  return buildFiscalInvoiceDraftPayload({
    now,
    report: { id: "33333333-3333-4333-8333-333333333333", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [source],
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

test("preserves zero-value invoice quantity and tax totals", () => {
  const result = draft({ ...item, units: 2, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "free" });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.payload?.invoices[0].expected_total_cents, 0);
  assert.equal(result.payload?.invoices[0].zero_value_reason, "free");
  assert.deepEqual(result.payload?.invoices[0].lines, [{
    odoo_product_id: 101, description: "Frozen yogurt", quantity: 2,
    gross_cents: 0, tax_base_cents: 0, vat_cents: 0, odoo_tax_id: 41,
  }]);
});

test("includes the coupon reason in the immutable zero-value payload", () => {
  const result = draft({ ...item, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "coupon" });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.payload?.invoices[0].zero_value_reason, "coupon");
});

test("keeps capability version 1 compatible except for coupon vends", () => {
  assert.deepEqual(draft(item, 1).blockers, []);
  assert.deepEqual(draft(item, 3).blockers, []);
  assert.deepEqual(draft({ ...item, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "free" }, 1).blockers, []);
  assert(draft({ ...item, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "coupon" }, 1).blockers.some((blocker) => /version 2.*coupon/.test(blocker)));
});

test("requires zero-value capability only when a queued item is zero-value", () => {
  assert.deepEqual(draft(item, null).blockers, []);
  assert(draft({ ...item, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "free" }, null).blockers.some((blocker) => blocker.includes("batch contains zero-value")));
});

test("blocks excluded-price Odoo tax configuration", () => {
  const now = Date.parse("2026-09-29T13:00:00Z");
  const configuration = {
    contract_version: 1, checked_at: "2026-09-29T12:00:00Z",
    capabilities: { fiscal_invoice_draft_creation: 1, fiscal_invoice_bulk_confirmation: 1, fiscal_zero_value_invoices: 2 },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" }, journal: { code: "VEND" },
    customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: false },
  };
  const result = buildFiscalInvoiceDraftPayload({
    now, report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [item], platformInvoiceIds: ["invoice"],
  });
  assert.equal(result.payload, null);
  assert(result.blockers.some((blocker) => blocker.includes("price-included")));
});

test("normalizes accepted report text and requires an explicit tax price mode", () => {
  const reportPayload = {
    contract_version: 1, checked_at: "2026-09-29T12:00:00Z",
    capabilities: { fiscal_invoice_draft_creation: 1, fiscal_invoice_bulk_confirmation: 1, fiscal_zero_value_invoices: 2 },
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
  assert(invalid.blockers.some((message) => message.includes("price-included")));
});

test("allows reviewed report age but blocks incapable, refund-warning, empty, and oversized draft sources", () => {
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
  assert(!blocked.blockers.some((message) => message.includes("stale")));
  assert(blocked.blockers.some((message) => message.includes("capabilities")));
  assert(blocked.blockers.some((message) => message.includes("Refund-warning")));
  const empty = buildFiscalInvoiceDraftPayload({
    now: Date.now(), report: { id: "id", checked_at: new Date().toISOString(), accepted: false, payload_sha256: "a".repeat(64), payload: {} },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items: [], platformInvoiceIds: [],
  });
  assert(empty.blockers.some((message) => message.includes("no eligible")));
  assert.throws(() => buildFiscalInvoiceConfirmationPayload(3, Array.from({ length: 501 }, (_, index) => ({ platform_invoice_id: String(index), odoo_move_id: index + 1, invoice_payload_sha256: "a".repeat(64) }))), /between 1 and 500/);
});

test("splits one frozen source into deterministic connector-sized draft batches", () => {
  const source = draft();
  assert(source.payload);
  const reportPayload = {
    contract_version: 1, checked_at: "2026-09-29T12:00:00Z",
    capabilities: { fiscal_invoice_draft_creation: 1, fiscal_invoice_bulk_confirmation: 1, fiscal_zero_value_invoices: 2 },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" }, journal: { code: "VEND" },
    customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: true },
  };
  const items = Array.from({ length: 1201 }, (_, index) => ({
    ...item,
    id: `item-${index}`,
    order_id: `order-${index}`,
    order_code: `SALE-${String(index).padStart(4, "0")}`,
  }));
  const ids = items.map((_value, index) => `invoice-${index}`);
  const result = buildFiscalInvoiceDraftBatches({
    now: Date.parse("2026-09-29T13:00:00Z"),
    report: { id: "report", checked_at: reportPayload.checked_at, accepted: true, payload_sha256: sha256(reportPayload), payload: reportPayload },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items, platformInvoiceIds: ids,
  });
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.batches.map((batch) => batch.payload.invoices.length), [500, 500, 201]);
  assert.deepEqual(result.batches.map((batch) => batch.sequence), [1, 2, 3]);
  assert.equal(result.batches[1].payload.invoices[0].platform_invoice_id, "invoice-500");
  assert.equal(result.batches[2].payload.invoices.at(-1)?.reference, "PAY-1");
  for (const batch of result.batches) assert.equal(batch.payloadSha256, sha256(batch.payload));
});

test("does not return partial draft batches when shared configuration is invalid", () => {
  const result = buildFiscalInvoiceDraftBatches({
    now: Date.now(), report: { id: "report", checked_at: new Date().toISOString(), accepted: false, payload_sha256: "a".repeat(64), payload: {} },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722,
    items: Array.from({ length: 501 }, (_, index) => ({ ...item, id: `item-${index}`, order_id: `order-${index}` })),
    platformInvoiceIds: Array.from({ length: 501 }, (_, index) => `invoice-${index}`),
  });
  assert.equal(result.batches.length, 0);
  assert(result.blockers.length > 0);
});

test("keeps the complete job bounded while retaining the 500-request limit", () => {
  const reportPayload = {
    checked_at: new Date().toISOString(), capabilities: { fiscal_invoice_draft_creation: 1, fiscal_invoice_bulk_confirmation: 1 },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" }, journal: { code: "VEND" },
    customer: { odoo_id: 722 }, tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: true },
  };
  const items = Array.from({ length: 50_001 }, (_, index) => ({ ...item, id: `item-${index}`, order_id: `order-${index}` }));
  const result = buildFiscalInvoiceDraftBatches({
    now: Date.now(), report: { id: "report", checked_at: reportPayload.checked_at, accepted: true, payload_sha256: sha256(reportPayload), payload: reportPayload },
    currency: "EUR", journalCode: "VEND", customerOdooId: 722, items,
    platformInvoiceIds: items.map((_value, index) => `invoice-${index}`),
  });
  assert.equal(result.batches.length, 0);
  assert(result.blockers.some((blocker) => blocker.includes("50,000")));
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

test("builds individual requested invoices and one consolidated monthly remainder", () => {
  const configuration = {
    checked_at: "2026-10-01T12:00:00Z", capabilities: { fiscal_invoice_allocation_v2: 1, manufacturing_transaction_sales: 1, fiscal_zero_value_invoices: 2 },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" }, journal: { code: "VEND" },
    customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: true },
  };
  const requested: FiscalInvoiceSourceItemV2 = {
    ...item, invoice_mode: "individual_requested", invoice_request_id: "55555555-5555-4555-8555-555555555555",
    customer_fiscal_details: { legal_name: "Customer SL", tax_id: "B123", email: "billing@example.com", address: "Main 1", postal_code: "28001", city: "Madrid", province: "Madrid", country_code: "ES" },
    customer_fiscal_details_sha256: "b".repeat(64), supporting_sale_order_id: "66666666-6666-4666-8666-666666666666",
    supporting_sale_order_source_sha256: "c".repeat(64),
    odoo_sale_order_id: 91, odoo_sale_order_line_id: 92,
  };
  const consolidated: FiscalInvoiceSourceItemV2 = {
    ...item, id: "77777777-7777-4777-8777-777777777777", order_id: "88888888-8888-4888-8888-888888888888",
    order_code: "SALE-2", invoice_mode: "monthly_consolidated", invoice_request_id: null,
    customer_fiscal_details: null, customer_fiscal_details_sha256: null,
    supporting_sale_order_id: "99999999-9999-4999-8999-999999999999", supporting_sale_order_source_sha256: "d".repeat(64),
    odoo_sale_order_id: 93, odoo_sale_order_line_id: 94,
  };
  const result = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "33333333-3333-4333-8333-333333333333", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09",
    monthInvoiceDate: "2026-09-30", items: [requested, consolidated],
    platformInvoiceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    platformAllocationIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
  });
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.payload?.invoices.map((invoice) => [invoice.invoice_mode, invoice.allocations.length]), [
    ["individual_requested", 1], ["monthly_consolidated", 1],
  ]);
  assert.equal(result.payload?.invoices[0].customer && "tax_id" in result.payload.invoices[0].customer ? result.payload.invoices[0].customer.tax_id : null, "B123");
  assert.deepEqual(result.payload?.invoices[1].customer, { odoo_id: 722 });
  assert.equal(result.payload?.invoices[0].lines[0].zero_value_reason, null);
  assert.equal(result.payload?.invoices[0].allocations[0].source_sha256, "a".repeat(64));
  assert.equal(result.payload?.invoices[0].allocations[0].supporting_sale_order_source_sha256, "c".repeat(64));
  assert.equal(result.payloadSha256, sha256(result.payload));

  const incompatible = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: "a".repeat(64), payload: {
      ...configuration, capabilities: { fiscal_invoice_allocation_v2: 1, manufacturing_transaction_sales: 2 },
    } },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09",
    monthInvoiceDate: "2026-09-30", items: [requested], platformInvoiceIds: ["invoice"], platformAllocationIds: ["allocation"],
  });
  assert(incompatible.blockers.some((blocker) => blocker.includes("capabilities version 1")));

  const zeroValue = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09", monthInvoiceDate: "2026-09-30",
    items: [{ ...requested, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "coupon" }],
    platformInvoiceIds: ["invoice"], platformAllocationIds: ["allocation"],
  });
  assert.equal(zeroValue.payload?.invoices[0].zero_value_reason, "coupon");
  assert.equal(zeroValue.payload?.invoices[0].lines[0].zero_value_reason, "coupon");

  const oneConsolidatedZeroValue = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09", monthInvoiceDate: "2026-09-30",
    items: [{ ...consolidated, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "free" }],
    platformInvoiceIds: ["invoice"], platformAllocationIds: ["allocation"],
  });
  assert.equal(oneConsolidatedZeroValue.payload?.invoices[0].zero_value_reason, null);
  assert.equal(oneConsolidatedZeroValue.payload?.invoices[0].lines[0].zero_value_reason, "free");

  const incapableZeroValue = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: "a".repeat(64), payload: {
      ...configuration, capabilities: { fiscal_invoice_allocation_v2: 1, manufacturing_transaction_sales: 1, fiscal_zero_value_invoices: 1 },
    } },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09", monthInvoiceDate: "2026-09-30",
    items: [{ ...requested, gross_cents: 0, tax_base_cents: 0, vat_cents: 0, zero_value_reason: "coupon" }],
    platformInvoiceIds: ["invoice"], platformAllocationIds: ["allocation"],
  });
  assert(incapableZeroValue.blockers.some((blocker) => blocker.includes("version 2 or newer")));

  const oversized = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09", monthInvoiceDate: "2026-09-30",
    items: [{ ...requested, description: "x".repeat(8_000_001) }], platformInvoiceIds: ["invoice"], platformAllocationIds: ["allocation"],
  });
  assert(oversized.blockers.some((blocker) => blocker.includes("8000000 bytes")));
});

test("fiscal v2 uses a v2 confirmation envelope", () => {
  const confirmation = buildFiscalInvoiceConfirmationPayload(3, [{
    platform_invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", odoo_move_id: 91,
    invoice_payload_sha256: "a".repeat(64),
  }], 2);
  assert.equal(confirmation.contract_version, 2);
});

test("fiscal v2 caps total individual and consolidated source lines at 5000", () => {
  const configuration = {
    checked_at: "2026-10-01T12:00:00Z",
    capabilities: { fiscal_invoice_allocation_v2: 1, manufacturing_transaction_sales: 1, fiscal_zero_value_invoices: 2 },
    company: { odoo_id: 3, country_code: "ES", currency: "EUR" }, journal: { code: "VEND" },
    customer: { odoo_id: 722 },
    tax: { odoo_id: 41, rate: 10, country_code: "ES", type_tax_use: "sale", amount_type: "percent", price_include: true },
  };
  const consolidatedItems = Array.from({ length: 5000 }, (_, index): FiscalInvoiceSourceItemV2 => ({
    ...item, id: `item-${index}`, order_id: `order-${index}`, order_code: `SALE-${index}`,
    invoice_mode: "monthly_consolidated", invoice_request_id: null, customer_fiscal_details: null,
    customer_fiscal_details_sha256: null, supporting_sale_order_id: `support-${index}`,
    supporting_sale_order_source_sha256: "c".repeat(64),
    odoo_sale_order_id: index + 1, odoo_sale_order_line_id: index + 1,
  }));
  const requested: FiscalInvoiceSourceItemV2 = {
    ...consolidatedItems[0], id: "requested", order_id: "requested-order", order_code: "REQUESTED",
    invoice_mode: "individual_requested", invoice_request_id: "request", customer_fiscal_details: {
      legal_name: "Customer SL", tax_id: "B123", email: "billing@example.com", address: "Main 1",
      postal_code: "28001", city: "Madrid", province: "Madrid", country_code: "ES",
    }, customer_fiscal_details_sha256: "b".repeat(64),
  };
  const items = [requested, ...consolidatedItems];
  const result = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09",
    monthInvoiceDate: "2026-09-30", items, platformInvoiceIds: ["individual-invoice", "consolidated-invoice"],
    platformAllocationIds: items.map((_value, index) => `allocation-${index}`),
  });
  assert(result.blockers.some((blocker) => blocker.includes("5000 source allocation lines")));

  const boundedItems = [requested, ...consolidatedItems.slice(0, 4999)];
  const bounded = buildFiscalInvoiceDraftPayloadV2({
    report: { id: "report", checked_at: configuration.checked_at, accepted: true, payload_sha256: sha256(configuration), payload: configuration },
    currency: "EUR", journalCode: "VEND", anonymousCustomerOdooId: 722, localMonth: "2026-09",
    monthInvoiceDate: "2026-09-30", items: boundedItems, platformInvoiceIds: ["individual-invoice", "consolidated-invoice"],
    platformAllocationIds: boundedItems.map((_value, index) => `allocation-${index}`),
  });
  assert(!bounded.blockers.some((blocker) => blocker.includes("source allocation lines")));
  assert(bounded.payload);
});

test("recognizes only closed post-cutover Madrid calendar months", () => {
  assert.deepEqual(closedFiscalMonth("2026-08-31T22:00:00.000Z", "2026-09-30T22:00:00.000Z", "Europe/Madrid", Date.parse("2026-10-01T00:00:00Z")), {
    month: "2026-09", invoiceDate: "2026-09-30",
  });
  assert.equal(closedFiscalMonth("2026-08-31T22:00:00.000Z", "2026-09-15T22:00:00.000Z", "Europe/Madrid"), null);
  assert.equal(closedFiscalMonth("2026-08-31T22:00:00.000Z", "2026-09-30T22:00:00.000Z", "UTC"), null);
});

test("fiscal v2 is whole-month fail-closed when any source is blocked", () => {
  assert.match(fiscalV2WholeMonthBlocker([{ status: "eligible" }, { status: "blocked" }]) ?? "", /whole-month fail-closed/);
  assert.equal(fiscalV2WholeMonthBlocker([{ status: "eligible" }, { status: "excluded" }]), null);
});
