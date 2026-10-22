import { canonicalJson, sha256 } from "./odoo-sync-contract.ts";
import type { ZeroValueVendReason } from "./odoo-fiscal-preflight.ts";
import type { CustomerFiscalDetails } from "./customer-invoice-requests.ts";

export const FISCAL_V2_CUTOVER_DATE = "2026-09-01";
export const FISCAL_V2_MAX_SOURCE_LINES = 5_000;
export const FISCAL_V2_MAX_PAYLOAD_BYTES = 8_000_000;
export const FISCAL_INVOICE_MAX_RESULT_BYTES = 500_000;

export function fiscalV2WholeMonthBlocker(items: Record<string, unknown>[]) {
  return items.some((item) => item.status === "blocked")
    ? "Fiscal v2 is whole-month fail-closed: resolve every blocked source and freeze a replacement preflight."
    : null;
}

export type FiscalInvoiceSourceItem = {
  id: string;
  order_id: string;
  operation_local_date: string;
  order_code: string;
  payment_reference: string | null;
  description: string;
  units: number;
  gross_cents: number;
  tax_base_cents: number;
  vat_cents: number;
  odoo_product_id: number;
  refund_required: boolean;
  source_sha256: string;
  zero_value_reason: ZeroValueVendReason | null;
};

export type FiscalInvoiceSourceItemV2 = FiscalInvoiceSourceItem & {
  invoice_mode: "individual_requested" | "monthly_consolidated";
  invoice_request_id: string | null;
  customer_fiscal_details: CustomerFiscalDetails | null;
  customer_fiscal_details_sha256: string | null;
  supporting_sale_order_id: string;
  supporting_sale_order_source_sha256: string;
  odoo_sale_order_id: number;
  odoo_sale_order_line_id: number;
};

export type FiscalInvoiceAllocationV2 = {
  platform_allocation_id: string;
  preflight_item_id: string;
  source_order_id: string;
  source_sha256: string;
  invoice_request_id: string | null;
  supporting_sale_order_id: string;
  supporting_sale_order_source_sha256: string;
  odoo_sale_order_id: number;
  odoo_sale_order_line_id: number;
  line_sequence: number;
};

export type FiscalInvoiceV2 = {
  platform_invoice_id: string;
  invoice_payload_sha256: string;
  move_type: "out_invoice";
  invoice_mode: "individual_requested" | "monthly_consolidated";
  local_month: string;
  invoice_date: string;
  currency: string;
  reference: string;
  customer: ({ odoo_id: number } | (CustomerFiscalDetails & { request_id: string; fiscal_details_sha256: string }));
  expected_total_cents: number;
  zero_value_reason: ZeroValueVendReason | null;
  allocations: FiscalInvoiceAllocationV2[];
  lines: Array<{
    platform_allocation_id: string;
    odoo_product_id: number;
    description: string;
    quantity: number;
    gross_cents: number;
    tax_base_cents: number;
    vat_cents: number;
    zero_value_reason: ZeroValueVendReason | null;
    odoo_tax_id: number;
    odoo_sale_order_id: number;
    odoo_sale_order_line_id: number;
  }>;
};

export type FiscalInvoiceDraftPayloadV2 = Omit<FiscalInvoiceDraftPayload, "contract_version" | "customer" | "invoices"> & {
  contract_version: 2;
  local_month: string;
  invoices: FiscalInvoiceV2[];
};

export type FiscalInvoice = {
  platform_invoice_id: string;
  invoice_payload_sha256: string;
  move_type: "out_invoice";
  invoice_date: string;
  currency: string;
  reference: string;
  expected_total_cents: number;
  zero_value_reason: ZeroValueVendReason | null;
  lines: {
    odoo_product_id: number;
    description: string;
    quantity: number;
    gross_cents: number;
    tax_base_cents: number;
    vat_cents: number;
    odoo_tax_id: number;
  }[];
};

export type FiscalInvoiceDraftPayload = {
  contract_version: 1;
  configuration_report_id: string;
  configuration_payload_sha256: string;
  company: { odoo_id: number; country_code: string; currency: string };
  journal: { code: string };
  customer: { odoo_id: number };
  tax: { odoo_tax_id: number; rate: number; country_code: string; type_tax_use: string; amount_type: string; price_include: boolean };
  invoices: FiscalInvoice[];
};

export type FiscalInvoiceDraftBatch = {
  sequence: number;
  payload: FiscalInvoiceDraftPayload;
  payloadSha256: string;
};

type ConfigurationReport = {
  id: string;
  checked_at: string;
  accepted: boolean;
  payload_sha256: string;
  payload: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildFiscalInvoiceDraftPayload(input: {
  now: number;
  report: ConfigurationReport;
  currency: string;
  journalCode: string;
  customerOdooId: number;
  items: FiscalInvoiceSourceItem[];
  platformInvoiceIds: string[];
}) {
  const blockers: string[] = [];
  const reportPayload = input.report.payload;
  const capabilities = object(reportPayload.capabilities);
  const company = object(reportPayload.company);
  const journal = object(reportPayload.journal);
  const customer = object(reportPayload.customer);
  const tax = object(reportPayload.tax);
  const companyId = positiveInteger(company.odoo_id);
  const customerId = positiveInteger(customer.odoo_id);
  const taxId = positiveInteger(tax.odoo_id);
  const checkedAt = Date.parse(input.report.checked_at);

  if (!input.report.accepted) blockers.push("The referenced fiscal configuration report is not accepted.");
  if (!Number.isFinite(checkedAt) || checkedAt > input.now + 5 * 60_000) blockers.push("The referenced fiscal configuration report has an invalid timestamp.");
  if (!(Number(capabilities.fiscal_invoice_draft_creation) >= 1) || !(Number(capabilities.fiscal_invoice_bulk_confirmation) >= 1)) blockers.push("Odoo must advertise fiscal invoice draft and bulk confirmation capabilities version 1 or newer.");
  const zeroValueCapability = Number(capabilities.fiscal_zero_value_invoices);
  if (input.items.some((item) => item.zero_value_reason !== null) && !(zeroValueCapability >= 1)) blockers.push("Odoo must advertise a supported zero-value fiscal invoice capability when the batch contains zero-value invoices.");
  if (input.items.some((item) => item.zero_value_reason === "coupon") && !(zeroValueCapability >= 2)) blockers.push("Odoo must advertise zero-value fiscal invoice capability version 2 or newer for coupon vends.");
  if (!companyId || !customerId || !taxId) blockers.push("The fiscal configuration report is missing required Odoo company, customer, or tax identifiers.");
  if (tax.price_include !== true) blockers.push("The accepted Odoo vending sales tax must be price-included.");
  if (customerId !== input.customerOdooId || requiredText(journal.code)?.toUpperCase() !== input.journalCode) blockers.push("The fiscal configuration report does not match the frozen customer or journal settings.");
  if (input.items.length === 0) blockers.push("The preflight has no eligible sales.");
  if (input.items.length > 500) blockers.push("A fiscal invoice batch cannot contain more than 500 sales.");
  if (input.platformInvoiceIds.length !== input.items.length || new Set(input.platformInvoiceIds).size !== input.items.length) blockers.push("Every sale requires one unique platform invoice ID.");
  if (input.items.some((item) => item.refund_required)) blockers.push("Refund-warning sales cannot be queued for invoice creation.");
  if (blockers.length || !companyId || !customerId || !taxId) return { blockers, payload: null, payloadSha256: null };

  const invoices = input.items.map((item, index) => {
    const unhashed = {
      platform_invoice_id: input.platformInvoiceIds[index],
      move_type: "out_invoice" as const,
      invoice_date: item.operation_local_date,
      currency: input.currency,
      reference: item.payment_reference || item.order_code,
      expected_total_cents: item.gross_cents,
      zero_value_reason: item.zero_value_reason,
      lines: [{
        odoo_product_id: item.odoo_product_id,
        description: item.description,
        quantity: item.units,
        gross_cents: item.gross_cents,
        tax_base_cents: item.tax_base_cents,
        vat_cents: item.vat_cents,
        odoo_tax_id: taxId,
      }],
    };
    return { ...unhashed, invoice_payload_sha256: sha256(unhashed) };
  });
  const payload: FiscalInvoiceDraftPayload = {
    contract_version: 1,
    configuration_report_id: input.report.id,
    configuration_payload_sha256: input.report.payload_sha256,
    company: { odoo_id: companyId, country_code: String(company.country_code).trim().toUpperCase(), currency: String(company.currency).trim().toUpperCase() },
    journal: { code: String(journal.code).trim().toUpperCase() },
    customer: { odoo_id: customerId },
    tax: {
      odoo_tax_id: taxId,
      rate: Number(tax.rate),
      country_code: String(tax.country_code).trim().toUpperCase(),
      type_tax_use: String(tax.type_tax_use).trim(),
      amount_type: String(tax.amount_type).trim(),
      price_include: tax.price_include === true,
    },
    invoices,
  };
  return { blockers, payload, payloadSha256: sha256(payload) };
}

export function buildFiscalInvoiceDraftBatches(input: {
  now: number;
  report: ConfigurationReport;
  currency: string;
  journalCode: string;
  customerOdooId: number;
  items: FiscalInvoiceSourceItem[];
  platformInvoiceIds: string[];
}) {
  if (!input.items.length) {
    const result = buildFiscalInvoiceDraftPayload(input);
    return { blockers: result.blockers, batches: [] as FiscalInvoiceDraftBatch[] };
  }
  if (input.items.length > 50_000) {
    return { blockers: ["A fiscal invoice job cannot contain more than 50,000 sales."], batches: [] as FiscalInvoiceDraftBatch[] };
  }
  if (input.platformInvoiceIds.length !== input.items.length || new Set(input.platformInvoiceIds).size !== input.items.length) {
    return { blockers: ["Every sale requires one unique platform invoice ID."], batches: [] as FiscalInvoiceDraftBatch[] };
  }
  const batches: FiscalInvoiceDraftBatch[] = [];
  const blockers = new Set<string>();
  for (let offset = 0; offset < input.items.length; offset += 500) {
    const result = buildFiscalInvoiceDraftPayload({
      ...input,
      items: input.items.slice(offset, offset + 500),
      platformInvoiceIds: input.platformInvoiceIds.slice(offset, offset + 500),
    });
    for (const blocker of result.blockers) blockers.add(blocker);
    if (result.payload && result.payloadSha256) {
      batches.push({ sequence: batches.length + 1, payload: result.payload, payloadSha256: result.payloadSha256 });
    }
  }
  return { blockers: [...blockers], batches: blockers.size ? [] : batches };
}

export function closedFiscalMonth(periodFrom: string, periodTo: string, timeZone: string, now = Date.now()) {
  if (timeZone !== "Europe/Madrid") return null;
  const from = new Date(periodFrom);
  const to = new Date(periodTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() > now) return null;
  const local = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}:${values.get("second")}`;
  };
  const localFrom = local(from);
  const localTo = local(to);
  if (!/^\d{4}-\d{2}-01T00:00:00$/.test(localFrom) || !/^\d{4}-\d{2}-01T00:00:00$/.test(localTo)) return null;
  const [year, month] = localFrom.slice(0, 7).split("-").map(Number);
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  if (localTo.slice(0, 7) !== nextMonth || localFrom.slice(0, 10) < FISCAL_V2_CUTOVER_DATE) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { month: localFrom.slice(0, 7), invoiceDate: `${localFrom.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

export function buildFiscalInvoiceDraftPayloadV2(input: {
  report: ConfigurationReport;
  currency: string;
  journalCode: string;
  anonymousCustomerOdooId: number;
  localMonth: string;
  monthInvoiceDate: string;
  items: FiscalInvoiceSourceItemV2[];
  platformInvoiceIds: string[];
  platformAllocationIds: string[];
}) {
  const blockers: string[] = [];
  const payload = input.report.payload;
  const capabilities = object(payload.capabilities);
  const company = object(payload.company);
  const journal = object(payload.journal);
  const anonymousCustomer = object(payload.customer);
  const tax = object(payload.tax);
  const companyId = positiveInteger(company.odoo_id);
  const taxId = positiveInteger(tax.odoo_id);
  if (!input.report.accepted || Number(capabilities.fiscal_invoice_allocation_v2) !== 1 || Number(capabilities.manufacturing_transaction_sales) !== 1) blockers.push("Odoo must advertise fiscal invoice allocation and manufacturing transaction-sales capabilities version 1.");
  const zeroValueCapability = Number(capabilities.fiscal_zero_value_invoices);
  if (input.items.some((item) => item.zero_value_reason !== null) && !(zeroValueCapability >= 1)) blockers.push("Odoo must advertise fiscal zero-value invoice capability version 1 or newer for included zero-value sources.");
  if (input.items.some((item) => item.zero_value_reason === "coupon") && !(zeroValueCapability >= 2)) blockers.push("Odoo must advertise fiscal zero-value invoice capability version 2 or newer for included coupon sources.");
  if (!companyId || !taxId || tax.price_include !== true) blockers.push("The accepted company and price-included tax configuration is required.");
  if (positiveInteger(anonymousCustomer.odoo_id) !== input.anonymousCustomerOdooId) blockers.push("The final-consumer customer does not match the accepted report.");
  if (requiredText(journal.code)?.toUpperCase() !== input.journalCode) blockers.push("The fiscal journal does not match the accepted report.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.localMonth)) blockers.push("A valid fiscal month is required.");
  if (!input.items.length) blockers.push("The preflight has no invoiceable sales.");
  if (input.platformAllocationIds.length !== input.items.length || new Set(input.platformAllocationIds).size !== input.items.length) blockers.push("Every source sale requires one unique allocation ID.");
  const requested = input.items.filter((item) => item.invoice_mode === "individual_requested");
  const consolidated = input.items.filter((item) => item.invoice_mode === "monthly_consolidated");
  if (input.items.length > FISCAL_V2_MAX_SOURCE_LINES) blockers.push(`Fiscal v2 cannot contain more than ${FISCAL_V2_MAX_SOURCE_LINES} source allocation lines in total.`);
  const documentCount = requested.length + (consolidated.length ? 1 : 0);
  if (documentCount > 500) blockers.push("Fiscal v2 cannot create more than 500 accounting documents in one monthly connector request.");
  if (input.platformInvoiceIds.length !== documentCount || new Set(input.platformInvoiceIds).size !== documentCount) blockers.push("Every accounting document requires one unique platform invoice ID.");
  if (requested.some((item) => !item.invoice_request_id || !item.customer_fiscal_details || !item.customer_fiscal_details_sha256)) blockers.push("Every requested invoice requires frozen customer fiscal details.");
  if (input.items.some((item) => item.refund_required || !positiveInteger(item.odoo_sale_order_id) || !positiveInteger(item.odoo_sale_order_line_id)
    || !/^[0-9a-f]{64}$/.test(item.supporting_sale_order_source_sha256))) blockers.push("Every source sale must be non-refund and linked to one current supporting Odoo sales-order line.");
  if (blockers.length || !companyId || !taxId) return { blockers, payload: null, payloadSha256: null };

  let allocationOffset = 0;
  let invoiceOffset = 0;
  const makeInvoice = (mode: FiscalInvoiceV2["invoice_mode"], sources: FiscalInvoiceSourceItemV2[], invoiceDate: string, customer: FiscalInvoiceV2["customer"], reference: string) => {
    const allocations = sources.map((item, index): FiscalInvoiceAllocationV2 => ({
      platform_allocation_id: input.platformAllocationIds[allocationOffset + index], preflight_item_id: item.id,
      source_order_id: item.order_id, source_sha256: item.source_sha256, invoice_request_id: item.invoice_request_id,
      supporting_sale_order_id: item.supporting_sale_order_id, supporting_sale_order_source_sha256: item.supporting_sale_order_source_sha256,
      odoo_sale_order_id: item.odoo_sale_order_id,
      odoo_sale_order_line_id: item.odoo_sale_order_line_id, line_sequence: index + 1,
    }));
    allocationOffset += sources.length;
    const unhashed = {
      platform_invoice_id: input.platformInvoiceIds[invoiceOffset++], move_type: "out_invoice" as const,
      invoice_mode: mode, local_month: input.localMonth, invoice_date: invoiceDate, currency: input.currency,
      reference, customer, expected_total_cents: sources.reduce((sum, item) => sum + item.gross_cents, 0),
      zero_value_reason: mode === "monthly_consolidated" ? null : sources[0].zero_value_reason, allocations,
      lines: sources.map((item, index) => ({
        platform_allocation_id: allocations[index].platform_allocation_id, odoo_product_id: item.odoo_product_id,
        description: item.description, quantity: item.units, gross_cents: item.gross_cents,
        tax_base_cents: item.tax_base_cents, vat_cents: item.vat_cents, zero_value_reason: item.zero_value_reason, odoo_tax_id: taxId,
        odoo_sale_order_id: item.odoo_sale_order_id, odoo_sale_order_line_id: item.odoo_sale_order_line_id,
      })),
    };
    return { ...unhashed, invoice_payload_sha256: sha256(unhashed) };
  };
  const invoices: FiscalInvoiceV2[] = requested.map((item) => makeInvoice("individual_requested", [item], item.operation_local_date, {
    ...item.customer_fiscal_details!, request_id: item.invoice_request_id!, fiscal_details_sha256: item.customer_fiscal_details_sha256!,
  }, item.payment_reference || item.order_code));
  if (consolidated.length) invoices.push(makeInvoice("monthly_consolidated", consolidated, input.monthInvoiceDate, { odoo_id: input.anonymousCustomerOdooId }, `SoftLife ${input.localMonth}`));
  const result: FiscalInvoiceDraftPayloadV2 = {
    contract_version: 2, local_month: input.localMonth, configuration_report_id: input.report.id,
    configuration_payload_sha256: input.report.payload_sha256,
    company: { odoo_id: companyId, country_code: String(company.country_code).trim().toUpperCase(), currency: String(company.currency).trim().toUpperCase() },
    journal: { code: String(journal.code).trim().toUpperCase() },
    tax: { odoo_tax_id: taxId, rate: Number(tax.rate), country_code: String(tax.country_code).trim().toUpperCase(), type_tax_use: String(tax.type_tax_use).trim(), amount_type: String(tax.amount_type).trim(), price_include: true },
    invoices,
  };
  if (Buffer.byteLength(canonicalJson(result), "utf8") > FISCAL_V2_MAX_PAYLOAD_BYTES) {
    return { blockers: [`The fiscal v2 connector payload exceeds ${FISCAL_V2_MAX_PAYLOAD_BYTES} bytes.`], payload: null, payloadSha256: null };
  }
  return { blockers, payload: result, payloadSha256: sha256(result) };
}

export function buildFiscalInvoiceConfirmationPayload(companyOdooId: number, documents: {
  platform_invoice_id: string;
  odoo_move_id: number;
  invoice_payload_sha256: string;
}[], contractVersion: 1 | 2 = 1) {
  if (!Number.isInteger(companyOdooId) || companyOdooId <= 0) throw new Error("A valid Odoo company ID is required.");
  if (!documents.length || documents.length > 500) throw new Error("Select between 1 and 500 draft invoices.");
  if (new Set(documents.map((document) => document.platform_invoice_id)).size !== documents.length) throw new Error("Duplicate invoice selection.");
  if (new Set(documents.map((document) => document.odoo_move_id)).size !== documents.length) throw new Error("Selected invoices must have distinct Odoo move IDs.");
  return { contract_version: contractVersion, company: { odoo_id: companyOdooId }, invoices: documents };
}

export function validateFiscalInvoiceResult(kind: string, requestPayload: Record<string, unknown>, result: Record<string, unknown>) {
  if (result.accepted !== true) return;
  const expected = Array.isArray(requestPayload.invoices) ? requestPayload.invoices.map(object) : [];
  const received = Array.isArray(result.invoices) ? result.invoices.map(object) : [];
  if (received.length !== expected.length) throw new Error("Invoice result must cover every requested invoice exactly once");
  const expectedById = new Map(expected.map((invoice) => [String(invoice.platform_invoice_id), invoice]));
  const seen = new Set<string>();
  const seenMoveIds = new Set<number>();
  for (const invoice of received) {
    const id = String(invoice.platform_invoice_id ?? "");
    const source = expectedById.get(id);
    if (!source || seen.has(id)) throw new Error("Invoice result contains an unknown or duplicate platform invoice ID");
    seen.add(id);
    const moveId = positiveInteger(invoice.odoo_move_id);
    if (invoice.invoice_payload_sha256 !== source.invoice_payload_sha256 || !moveId) throw new Error("Invoice result identity or Odoo move ID is invalid");
    if (seenMoveIds.has(moveId)) throw new Error("Invoice result contains a duplicate Odoo move ID");
    seenMoveIds.add(moveId);
    if (kind === "fiscal_invoice_draft_creation") {
      if (invoice.state !== "draft" || typeof invoice.created !== "boolean") throw new Error("Draft result must include a draft invoice and created flag");
    } else if (kind === "fiscal_invoice_bulk_confirmation") {
      if (invoice.state !== "posted" || typeof invoice.confirmed !== "boolean" || !requiredText(invoice.name)) throw new Error("Confirmation result must include a posted invoice name and confirmed flag");
    }
  }
}

export type FiscalCalendarSpan = { id: string; local_date_from: string; local_date_to: string; status: string };

export function isFiscalCalendarMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function fiscalCalendarMonth(month: string, spans: FiscalCalendarSpan[]) {
  if (!isFiscalCalendarMonth(month)) throw new Error("Invalid calendar month.");
  const [year, monthNumber] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const leading = new Date(`${first}T00:00:00Z`).getUTCDay();
  const cells = Array.from({ length: Math.ceil((leading + lastDay) / 7) * 7 }, (_, index) => {
    const day = index - leading + 1;
    if (day < 1 || day > lastDay) return null;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    return { date, spans: spans.filter((span) => span.local_date_from <= date && span.local_date_to >= date) };
  });
  return {
    first, last, cells,
    clippedSpans: spans.filter((span) => span.local_date_from <= last && span.local_date_to >= first).map((span) => ({
      ...span,
      visible_from: span.local_date_from < first ? first : span.local_date_from,
      visible_to: span.local_date_to > last ? last : span.local_date_to,
    })),
  };
}

export function canonicalFiscalPayload(value: unknown) {
  return canonicalJson(value);
}
