import { FRANCHISEE_CONTRACT_VERSION } from "./franchisee-onboarding-contract.ts";
import { canonicalJson, sha256 } from "./odoo-sync-contract.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PAYOUT_SELF_BILL_MAX_RESULT_BYTES = 20_000;
export const LEGACY_PAYOUT_CONTRACT_VERSION = "SL-GESTOR-2026-10-26-v3";
export type PayoutSelfBillKind = "payout_vendor_bill_draft_creation" | "payout_vendor_bill_posting" | "payout_vendor_bill_pdf_export";
export type PayoutSelfBillVendor = {
  legal_name: string;
  tax_id: string;
  email: string;
  address_line_1: string;
  address_line_2: string | null;
  postal_code: string;
  city: string;
  province: string;
  country_code: "ES";
};
export type PayoutSelfBillDraftPayload = {
  schema_version: 1;
  bill: {
    platform_bill_id: string;
    settlement_id: string;
    tenant_id: string;
    period_month: string;
    invoice_date: string;
    currency: "EUR";
    move_type: "in_invoice";
    reference: string;
    description: string;
    gross_cents: number;
    tax_base_cents: number;
    iva_cents: number;
    iva_rate_percent: 21;
    contract_acceptance_id: string | null;
    contract_version: typeof FRANCHISEE_CONTRACT_VERSION | typeof LEGACY_PAYOUT_CONTRACT_VERSION;
    source_snapshot_sha256: string;
    vendor: PayoutSelfBillVendor;
  };
};

function nonempty(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

export function payoutSelfBillTaxBreakdown(taxBaseCents: number) {
  if (!Number.isSafeInteger(taxBaseCents) || taxBaseCents <= 0) throw new Error("Tax base cents must be a positive integer");
  const ivaCents = Math.round(taxBaseCents * 21 / 100);
  return { grossCents: taxBaseCents + ivaCents, taxBaseCents, ivaCents };
}

function legacyPayoutSelfBillTaxBreakdown(grossCents: number) {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) throw new Error("Gross cents must be a positive integer");
  const taxBaseCents = Math.round(grossCents * 100 / 121);
  return { grossCents, taxBaseCents, ivaCents: grossCents - taxBaseCents };
}

export function payoutSelfBillInvoiceDate(periodMonth: string): string {
  if (!MONTH.test(periodMonth)) throw new Error("Invalid payout period month");
  const [year, month] = periodMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

export function spanishPayoutCountryCode(value: string | null | undefined): "ES" | null {
  const normalized = value?.trim().toLocaleLowerCase("es-ES");
  return normalized === "es" || normalized === "spain" || normalized === "españa" || normalized === "espana" ? "ES" : null;
}

export function buildPayoutSelfBillDraftPayload(input: {
  platformBillId: string;
  settlementId: string;
  tenantId: string;
  periodMonth: string;
  invoiceDate: string;
  taxBaseCents: number;
  contractAcceptanceId: string | null;
  sourceSnapshotSha256: string;
  vendor: PayoutSelfBillVendor;
}): { payload: PayoutSelfBillDraftPayload; payloadSha256: string } {
  const amounts = payoutSelfBillTaxBreakdown(input.taxBaseCents);
  const payload: PayoutSelfBillDraftPayload = {
    schema_version: 1,
    bill: {
      platform_bill_id: input.platformBillId,
      settlement_id: input.settlementId,
      tenant_id: input.tenantId,
      period_month: input.periodMonth,
      invoice_date: input.invoiceDate,
      currency: "EUR",
      move_type: "in_invoice",
      reference: `AUTOFAC-${input.periodMonth}-${input.tenantId}`,
      description: `Retribución mensual ${input.periodMonth}; facturación por el destinatario`,
      gross_cents: amounts.grossCents,
      tax_base_cents: amounts.taxBaseCents,
      iva_cents: amounts.ivaCents,
      iva_rate_percent: 21,
      contract_acceptance_id: input.contractAcceptanceId,
      contract_version: FRANCHISEE_CONTRACT_VERSION,
      source_snapshot_sha256: input.sourceSnapshotSha256,
      vendor: input.vendor,
    },
  };
  validatePayoutSelfBillPayload("payout_vendor_bill_draft_creation", payload);
  return { payload, payloadSha256: sha256(payload) };
}

export function buildPayoutSelfBillPostPayload(bill: { id: string; odooMoveId: number; payloadSha256: string }) {
  const payload = { schema_version: 1 as const, bill: { platform_bill_id: bill.id, odoo_move_id: bill.odooMoveId, payload_sha256: bill.payloadSha256 } };
  validatePayoutSelfBillPayload("payout_vendor_bill_posting", payload);
  return { payload, payloadSha256: sha256(payload) };
}

export function buildPayoutSelfBillPdfPayload(bill: { id: string; odooMoveId: number; payloadSha256: string; odooName: string }) {
  const payload = { schema_version: 1 as const, bill: { platform_bill_id: bill.id, odoo_move_id: bill.odooMoveId, payload_sha256: bill.payloadSha256, odoo_name: bill.odooName } };
  validatePayoutSelfBillPayload("payout_vendor_bill_pdf_export", payload);
  return { payload, payloadSha256: sha256(payload) };
}

export function validatePayoutSelfBillPayload(kind: PayoutSelfBillKind, input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("Self-bill payload must be an object");
  const payload = input as Record<string, unknown>;
  if (!exactKeys(payload, ["schema_version", "bill"]) || payload.schema_version !== 1 || !payload.bill || typeof payload.bill !== "object") throw new Error("Invalid self-bill payload envelope");
  const bill = payload.bill as Record<string, unknown>;
  if (!UUID.test(String(bill.platform_bill_id ?? ""))) throw new Error("Invalid platform bill ID");
  if (kind === "payout_vendor_bill_draft_creation") {
    const keys = ["platform_bill_id", "settlement_id", "tenant_id", "period_month", "invoice_date", "currency", "move_type", "reference", "description", "gross_cents", "tax_base_cents", "iva_cents", "iva_rate_percent", "contract_acceptance_id", "contract_version", "source_snapshot_sha256", "vendor"];
    if (!exactKeys(bill, keys) || !UUID.test(String(bill.settlement_id ?? "")) || !UUID.test(String(bill.tenant_id ?? "")) || !(bill.contract_acceptance_id === null || UUID.test(String(bill.contract_acceptance_id)))) throw new Error("Invalid draft self-bill identity");
    if (!MONTH.test(String(bill.period_month ?? "")) || !DATE.test(String(bill.invoice_date ?? "")) || bill.currency !== "EUR" || bill.move_type !== "in_invoice") throw new Error("Invalid draft self-bill accounting fields");
    const contractVersion = String(bill.contract_version ?? "");
    if (contractVersion === LEGACY_PAYOUT_CONTRACT_VERSION && bill.contract_acceptance_id === null) throw new Error("Legacy self-bill contract acceptance is required");
    const [year, month] = String(bill.period_month).split("-").map(Number);
    const expectedDate = contractVersion === LEGACY_PAYOUT_CONTRACT_VERSION
      ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
      : payoutSelfBillInvoiceDate(String(bill.period_month));
    if (bill.invoice_date !== expectedDate || bill.reference !== `AUTOFAC-${bill.period_month}-${bill.tenant_id}` || !nonempty(bill.reference, 200) || !nonempty(bill.description) || !bill.description.includes("facturación por el destinatario")) throw new Error("Invalid self-bill reference or description");
    const amounts = contractVersion === LEGACY_PAYOUT_CONTRACT_VERSION
      ? legacyPayoutSelfBillTaxBreakdown(Number(bill.gross_cents))
      : payoutSelfBillTaxBreakdown(Number(bill.tax_base_cents));
    if (bill.tax_base_cents !== amounts.taxBaseCents || bill.iva_cents !== amounts.ivaCents || bill.iva_rate_percent !== 21) throw new Error("Invalid self-bill IVA breakdown");
    if (bill.gross_cents !== amounts.grossCents || ![FRANCHISEE_CONTRACT_VERSION, LEGACY_PAYOUT_CONTRACT_VERSION].includes(contractVersion) || !SHA256.test(String(bill.source_snapshot_sha256 ?? ""))) throw new Error("Invalid self-bill evidence");
    if (!bill.vendor || typeof bill.vendor !== "object") throw new Error("Self-bill vendor is required");
    const vendor = bill.vendor as Record<string, unknown>;
    const vendorKeys = ["legal_name", "tax_id", "email", "address_line_1", "address_line_2", "postal_code", "city", "province", "country_code"];
    if (!exactKeys(vendor, vendorKeys) || !nonempty(vendor.legal_name) || !nonempty(vendor.tax_id) || !nonempty(vendor.email) || !nonempty(vendor.address_line_1) || !(vendor.address_line_2 === null || typeof vendor.address_line_2 === "string") || !nonempty(vendor.postal_code) || !nonempty(vendor.city) || !nonempty(vendor.province) || vendor.country_code !== "ES") throw new Error("Incomplete self-bill vendor identity");
    return;
  }
  const keys = kind === "payout_vendor_bill_posting" ? ["platform_bill_id", "odoo_move_id", "payload_sha256"] : ["platform_bill_id", "odoo_move_id", "payload_sha256", "odoo_name"];
  if (!exactKeys(bill, keys) || !Number.isSafeInteger(bill.odoo_move_id) || Number(bill.odoo_move_id) <= 0 || !SHA256.test(String(bill.payload_sha256 ?? ""))) throw new Error("Invalid self-bill queue identity");
  if (kind === "payout_vendor_bill_pdf_export" && !nonempty(bill.odoo_name)) throw new Error("Odoo bill name is required");
}

export function validatePayoutSelfBillResult(kind: PayoutSelfBillKind, payloadInput: unknown, resultInput: unknown): void {
  validatePayoutSelfBillPayload(kind, payloadInput);
  if (!resultInput || typeof resultInput !== "object") throw new Error("Self-bill result must be an object");
  const result = resultInput as Record<string, unknown>;
  if (result.accepted !== true) return;
  if (!result.bill || typeof result.bill !== "object") throw new Error("Successful self-bill result must include bill details");
  const expected = (payloadInput as { bill: Record<string, unknown> }).bill;
  const bill = result.bill as Record<string, unknown>;
  if (bill.platform_bill_id !== expected.platform_bill_id) throw new Error("Self-bill result platform identity mismatch");
  if (kind === "payout_vendor_bill_draft_creation") {
    const keys = ["platform_bill_id", "odoo_move_id", "odoo_partner_id", "odoo_journal_id", "payload_sha256", "state", "created", "amount_total_cents"];
    if (!exactKeys(bill, keys) || !Number.isSafeInteger(bill.odoo_move_id) || Number(bill.odoo_move_id) <= 0 || !Number.isSafeInteger(bill.odoo_partner_id) || Number(bill.odoo_partner_id) <= 0 || !Number.isSafeInteger(bill.odoo_journal_id) || Number(bill.odoo_journal_id) <= 0 || bill.payload_sha256 !== sha256(payloadInput) || bill.state !== "draft" || typeof bill.created !== "boolean" || bill.amount_total_cents !== expected.gross_cents) throw new Error("Invalid draft self-bill result");
    return;
  }
  const shared = bill.odoo_move_id === expected.odoo_move_id && bill.payload_sha256 === expected.payload_sha256 && bill.state === "posted";
  if (!shared) throw new Error("Self-bill result identity mismatch");
  if (kind === "payout_vendor_bill_posting") {
    if (!exactKeys(bill, ["platform_bill_id", "odoo_move_id", "payload_sha256", "state", "name", "posted"]) || !nonempty(bill.name) || typeof bill.posted !== "boolean") throw new Error("Invalid posted self-bill result");
    return;
  }
  if (!exactKeys(bill, ["platform_bill_id", "odoo_move_id", "payload_sha256", "state", "odoo_attachment_id", "pdf_sha256", "pdf_size_bytes"]) || !Number.isSafeInteger(bill.odoo_attachment_id) || Number(bill.odoo_attachment_id) <= 0 || !SHA256.test(String(bill.pdf_sha256 ?? "")) || !Number.isSafeInteger(bill.pdf_size_bytes) || Number(bill.pdf_size_bytes) <= 0 || Number(bill.pdf_size_bytes) > 5 * 1024 * 1024) throw new Error("Invalid self-bill PDF result");
}

export function canonicalPayoutSelfBillJson(value: unknown) {
  return canonicalJson(value);
}
