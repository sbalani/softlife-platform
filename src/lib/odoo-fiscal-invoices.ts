import { canonicalJson, sha256 } from "./odoo-sync-contract.ts";
import type { ZeroValueVendReason } from "./odoo-fiscal-preflight.ts";

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
  if (!Number.isFinite(checkedAt) || input.now - checkedAt > 24 * 60 * 60_000 || checkedAt > input.now + 5 * 60_000) blockers.push("The referenced fiscal configuration report is stale or has an invalid timestamp.");
  if (Number(capabilities.fiscal_invoice_draft_creation) !== 1 || Number(capabilities.fiscal_invoice_bulk_confirmation) !== 1) blockers.push("Odoo must advertise fiscal invoice draft and bulk confirmation capabilities version 1.");
  if (Number(capabilities.fiscal_zero_value_invoices) !== 1) blockers.push("Odoo must advertise zero-value fiscal invoice capability version 1.");
  if (!companyId || !customerId || !taxId) blockers.push("The fiscal configuration report is missing required Odoo company, customer, or tax identifiers.");
  if (typeof tax.price_include !== "boolean") blockers.push("The fiscal configuration report has no valid tax price-inclusion mode.");
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

export function buildFiscalInvoiceConfirmationPayload(companyOdooId: number, documents: {
  platform_invoice_id: string;
  odoo_move_id: number;
  invoice_payload_sha256: string;
}[]) {
  if (!Number.isInteger(companyOdooId) || companyOdooId <= 0) throw new Error("A valid Odoo company ID is required.");
  if (!documents.length || documents.length > 500) throw new Error("Select between 1 and 500 draft invoices.");
  if (new Set(documents.map((document) => document.platform_invoice_id)).size !== documents.length) throw new Error("Duplicate invoice selection.");
  if (new Set(documents.map((document) => document.odoo_move_id)).size !== documents.length) throw new Error("Selected invoices must have distinct Odoo move IDs.");
  return { contract_version: 1 as const, company: { odoo_id: companyOdooId }, invoices: documents };
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
