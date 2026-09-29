import { isAdminOverride } from "./i18n/huaxin.ts";
import { canonicalJson, sha256 } from "./odoo-sync-contract.ts";

export type FiscalFinding = {
  severity: "blocker" | "warning" | "info";
  code: string;
  message: string;
};

export type FiscalSettings = {
  journal_code: string;
  customer_odoo_id: number;
  vat_rate: number;
  currency: string;
  income_account_code: string;
  tax_treatment_approved: boolean;
  posting_enabled: boolean;
};

export type FiscalRecipe = {
  id: string;
  name: string;
  odoo_finished_product_id: number | null;
};

export type FiscalProductCheck = {
  odoo_product_id: number;
  sale_ok: boolean;
  income_account_code: string | null;
  sale_tax_rates: number[];
  sale_tax_country_codes: string[];
  sale_taxes: { odoo_tax_id: number; rate: number; country_code: string; price_include: boolean; amount_type: string; type_tax_use: string }[];
};

export type FiscalConfigurationEvaluation = {
  accepted: boolean;
  checkedAt: string;
  findings: FiscalFinding[];
  products: FiscalProductCheck[];
  payload: Record<string, unknown>;
};

export type FiscalPreflightItem = {
  order_id: string;
  status: "eligible" | "blocked" | "excluded";
  operation_at: string | null;
  operation_local_date: string | null;
  order_code: string;
  payment_reference: string | null;
  description: string | null;
  units: number | null;
  gross_cents: number | null;
  tax_base_cents: number | null;
  vat_cents: number | null;
  recipe_id: string | null;
  odoo_product_id: number | null;
  refund_required: boolean;
  refund_reference: string | null;
  findings: FiscalFinding[];
  source_snapshot: Record<string, unknown>;
  source_sha256: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function numericArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isFinite);
}

export function evaluateFiscalConfiguration(settings: FiscalSettings, body: Record<string, unknown>): FiscalConfigurationEvaluation {
  const findings: FiscalFinding[] = [];
  const checkedAt = text(body.checked_at);
  const company = record(body.company);
  const journal = record(body.journal);
  const customer = record(body.customer);
  const tax = record(body.tax);
  const rawProducts = Array.isArray(body.products) ? body.products : [];

  if (Number(body.contract_version) !== 1) findings.push({ severity: "blocker", code: "unsupported_contract", message: "Odoo must report fiscal configuration contract version 1." });
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) findings.push({ severity: "blocker", code: "invalid_checked_at", message: "Odoo configuration report has no valid checked_at timestamp." });
  else if (Date.parse(checkedAt) > Date.now() + 5 * 60_000) findings.push({ severity: "blocker", code: "future_checked_at", message: "Odoo configuration report timestamp is in the future." });
  if (text(company.country_code).toUpperCase() !== "ES") findings.push({ severity: "blocker", code: "company_not_spanish", message: "The issuing Odoo company fiscal country must be Spain." });
  if (!text(company.vat)) findings.push({ severity: "blocker", code: "company_vat_missing", message: "The issuing Odoo company has no VAT/NIF." });
  if (text(company.currency).toUpperCase() !== settings.currency) findings.push({ severity: "blocker", code: "company_currency_mismatch", message: `Odoo company currency must be ${settings.currency}.` });
  if (text(journal.code).toUpperCase() !== settings.journal_code) findings.push({ severity: "blocker", code: "journal_code_mismatch", message: `The fiscal sales journal code must be ${settings.journal_code}.` });
  if (text(journal.type) !== "sale") findings.push({ severity: "blocker", code: "journal_type_invalid", message: "The fiscal journal must be a Sales journal." });
  if (journal.refund_sequence !== true) findings.push({ severity: "blocker", code: "refund_sequence_missing", message: "The fiscal journal must use a dedicated credit-note sequence." });
  if (journal.secure_posted_entries !== true) findings.push({ severity: "warning", code: "journal_hash_disabled", message: "Secure Posted Entries with Hash remains disabled. Enable it before the first real invoice is posted." });
  if (positiveInteger(customer.odoo_id) !== settings.customer_odoo_id) findings.push({ severity: "blocker", code: "customer_mismatch", message: `The final-consumer customer must be Odoo ID ${settings.customer_odoo_id}.` });
  if (text(customer.country_code).toUpperCase() !== "ES") findings.push({ severity: "blocker", code: "customer_country_invalid", message: "The final-consumer customer country must be Spain." });
  if (text(customer.vat)) findings.push({ severity: "blocker", code: "customer_vat_present", message: "The anonymous final-consumer customer must not have a VAT number." });
  if (positiveInteger(tax.odoo_id) === null || text(tax.type_tax_use) !== "sale" || text(tax.amount_type) !== "percent") findings.push({ severity: "blocker", code: "sales_tax_invalid", message: "Odoo must report a valid percentage-based Spanish sales tax." });
  const reportedTaxRate = Number(tax.rate);
  if (!Number.isFinite(reportedTaxRate) || Math.abs(reportedTaxRate - settings.vat_rate) > 0.0001) findings.push({ severity: "blocker", code: "sales_tax_rate_mismatch", message: `The configured sales tax must be ${settings.vat_rate}%.` });
  if (text(tax.country_code).toUpperCase() !== "ES") findings.push({ severity: "blocker", code: "sales_tax_country_invalid", message: "The configured sales tax must belong to Spain." });

  const products: FiscalProductCheck[] = [];
  const productIds = new Set<number>();
  for (const raw of rawProducts) {
    const product = record(raw);
    const id = positiveInteger(product.odoo_product_id);
    if (id === null || productIds.has(id)) {
      findings.push({ severity: "blocker", code: "invalid_product_report", message: "Odoo reported an invalid or duplicate finished product." });
      continue;
    }
    productIds.add(id);
    products.push({
      odoo_product_id: id,
      sale_ok: product.sale_ok === true,
      income_account_code: text(product.income_account_code) || null,
      sale_tax_rates: numericArray(product.sale_tax_rates),
      sale_tax_country_codes: Array.isArray(product.sale_tax_country_codes)
        ? product.sale_tax_country_codes.map((value) => text(value).toUpperCase()).filter(Boolean)
        : [],
      sale_taxes: Array.isArray(product.sale_taxes) ? product.sale_taxes.map((value) => record(value)).flatMap((taxRow) => {
        const taxId = positiveInteger(taxRow.odoo_tax_id);
        const rate = Number(taxRow.rate);
        const countryCode = text(taxRow.country_code).toUpperCase();
        return taxId && Number.isFinite(rate) && countryCode
          ? [{
            odoo_tax_id: taxId, rate, country_code: countryCode,
            price_include: taxRow.price_include === true,
            amount_type: text(taxRow.amount_type), type_tax_use: text(taxRow.type_tax_use),
          }]
          : [];
      }) : [],
    });
  }

  return {
    accepted: !findings.some((finding) => finding.severity === "blocker"),
    checkedAt,
    findings,
    products,
    payload: body,
  };
}

function decimalHundredths(value: unknown): number | null {
  const match = String(value ?? "").trim().match(/^\+?(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] ?? "";
  let result = BigInt(match[1]) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  if (Number(fraction[2] ?? "0") >= 5) result += BigInt(1);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

export function fiscalGrossBreakdown(gross: unknown, vatRate: number) {
  const grossCents = decimalHundredths(gross);
  const rateHundredths = decimalHundredths(vatRate);
  if (grossCents === null || grossCents <= 0 || rateHundredths === null || rateHundredths <= 0) return null;
  const denominator = BigInt(10_000 + rateHundredths);
  const baseCents = Number((BigInt(grossCents) * BigInt(10_000) + denominator / BigInt(2)) / denominator);
  return { grossCents, baseCents, vatCents: grossCents - baseCents };
}

export function fiscalCsvCell(value: unknown) {
  let output = value == null ? "" : String(value);
  if (/^\s*[=+\-@]/.test(output) || /^[\t\r]/.test(output)) output = `'${output}`;
  return `"${output.replaceAll('"', '""')}"`;
}

export function operationLocalDate(timestamp: string | null, timeZone: string): string | null {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function completed(order: Record<string, unknown>) {
  return ["3", "COMPLETE"].includes(text(order.order_state).toUpperCase());
}

function refunded(order: Record<string, unknown>) {
  return ["1", "REFUNDED"].includes(text(order.refund_status).toUpperCase());
}

export function buildFiscalPreflightItem(input: {
  order: Record<string, unknown>;
  resolutions: Record<string, unknown>[];
  recipes: Map<string, FiscalRecipe>;
  settings: FiscalSettings;
  timeZone: string;
  duplicatePaymentReference: boolean;
  verifiedProducts: Map<number, FiscalProductCheck> | null;
}): FiscalPreflightItem {
  const { order, resolutions, recipes, settings, timeZone, duplicatePaymentReference, verifiedProducts } = input;
  const findings: FiscalFinding[] = [];
  const orderId = text(order.id);
  const orderCode = text(order.order_code);
  const operationAt = text(order.order_time) || null;
  const localDate = operationLocalDate(operationAt, timeZone);
  const units = Number(order.nums);
  const breakdown = fiscalGrossBreakdown(order.price, settings.vat_rate);
  const refundRequired = refunded(order);

  if (!completed(order)) findings.push({ severity: "info", code: "not_completed", message: "Order is not completed and is excluded from invoicing." });
  if (isAdminOverride(text(order.pay_type_raw) || null)) findings.push({ severity: "info", code: "admin_override", message: "Administrative machine operation is excluded from invoicing." });
  const excluded = findings.some((finding) => finding.code === "not_completed" || finding.code === "admin_override");

  let recipe: FiscalRecipe | null = null;
  if (!excluded) {
    if (!orderId || !orderCode) findings.push({ severity: "blocker", code: "missing_order_identity", message: "The sale has no stable platform/order identity." });
    if (!operationAt || !localDate) findings.push({ severity: "blocker", code: "missing_operation_time", message: "The sale has no valid operation timestamp." });
    if (!breakdown) findings.push({ severity: "blocker", code: "invalid_gross_total", message: "The sale total must be a positive monetary amount." });
    else if (breakdown.grossCents > 300_000) findings.push({ severity: "blocker", code: "simplified_invoice_limit_exceeded", message: "The sale exceeds the EUR 3,000 simplified-invoice limit used for vending retail controls." });
    if (!Number.isInteger(units) || units <= 0) findings.push({ severity: "blocker", code: "invalid_units", message: "The sold quantity must be a positive whole number." });
    if (text(order.currency).toUpperCase() !== settings.currency) findings.push({ severity: "blocker", code: "currency_mismatch", message: `The sale currency must be ${settings.currency}.` });
    if (duplicatePaymentReference) findings.push({ severity: "blocker", code: "duplicate_payment_reference", message: "The payment reference is duplicated within this preflight period." });
    if (!text(order.out_trade_no)) findings.push({ severity: "warning", code: "payment_reference_missing", message: "No provider payment reference is stored; the platform order UUID remains the idempotency key." });

    const rawProducts = Array.isArray(order.products) ? order.products.filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object") : [];
    const sourceLines = rawProducts.length ? rawProducts : [{ goodsName: order.product_name }];
    const resolutionsByLine = new Map(resolutions.map((resolution) => [Number(resolution.line_index), resolution]));
    const evidenceMatches = resolutions.length === sourceLines.length && sourceLines.every((line, index) => {
      const resolution = resolutionsByLine.get(index);
      return resolution
        && text(resolution.raw_name) === text(line.goodsName)
        && (resolution.raw_position == null ? null : String(resolution.raw_position)) === (line.position == null ? null : String(line.position));
    });
    const active = resolutions.filter((resolution) => text(resolution.resolution_status) !== "ignored");
    if (!evidenceMatches) {
      findings.push({ severity: "blocker", code: "stale_product_resolution", message: "Stored product resolution evidence no longer matches the current source sale lines." });
    } else if (!active.length || active.some((resolution) => text(resolution.resolution_status) !== "resolved")) {
      findings.push({ severity: "blocker", code: "missing_product_resolution", message: "Sale lines have not been durably resolved to one finished recipe." });
    } else {
      const recipeIds = [...new Set(active.map((resolution) => text(resolution.recipe_id)).filter(Boolean))];
      if (recipeIds.length !== 1) findings.push({ severity: "blocker", code: "ambiguous_finished_product", message: "Sale lines do not resolve to exactly one finished recipe." });
      else {
        recipe = recipes.get(recipeIds[0]) ?? null;
        if (!recipe) findings.push({ severity: "blocker", code: "recipe_missing", message: "The resolved recipe no longer exists or is inactive." });
        else if (!positiveInteger(recipe.odoo_finished_product_id)) findings.push({ severity: "blocker", code: "odoo_finished_product_missing", message: "The resolved recipe has no Odoo finished-product mapping." });
      }
    }

    if (recipe?.odoo_finished_product_id && verifiedProducts) {
      const product = verifiedProducts.get(recipe.odoo_finished_product_id);
      if (!product) findings.push({ severity: "blocker", code: "odoo_product_not_verified", message: `Odoo did not report finished product ${recipe.odoo_finished_product_id} in its fiscal configuration check.` });
      else {
        if (!product.sale_ok) findings.push({ severity: "blocker", code: "odoo_product_not_saleable", message: `Odoo product ${product.odoo_product_id} is not saleable.` });
        if (product.income_account_code !== settings.income_account_code) findings.push({ severity: "blocker", code: "income_account_mismatch", message: `Odoo product ${product.odoo_product_id} must resolve to income account ${settings.income_account_code}.` });
        if (!product.sale_taxes.some((taxRow) => Math.abs(taxRow.rate - settings.vat_rate) < 0.0001 && taxRow.country_code === "ES" && taxRow.type_tax_use === "sale" && taxRow.amount_type === "percent")) findings.push({ severity: "blocker", code: "product_tax_mismatch", message: `Odoo product ${product.odoo_product_id} must carry the percentage-based Spanish ${settings.vat_rate}% customer tax.` });
      }
    }
    if (refundRequired) findings.push({ severity: "warning", code: "refund_requires_review", message: "Create the original invoice first; refund evidence needs review before a full credit note can be queued." });
    if (refundRequired && !text(order.refund_out_no)) findings.push({ severity: "warning", code: "refund_reference_missing", message: "The refunded sale has no provider refund reference." });
  }

  const sourceSnapshot = JSON.parse(canonicalJson({
    id: order.id,
    order_code: order.order_code,
    out_trade_no: order.out_trade_no,
    order_state: order.order_state,
    status_code: order.status_code,
    order_time: order.order_time,
    pay_time: order.pay_time,
    price: order.price,
    nums: order.nums,
    product_name: order.product_name,
    products: order.products,
    pay_type_raw: order.pay_type_raw,
    refund_status: order.refund_status,
    refund_out_no: order.refund_out_no,
    currency: order.currency,
    machine_id: order.machine_id,
    device_imei: order.device_imei,
    recipe_id: recipe?.id ?? null,
    odoo_product_id: recipe?.odoo_finished_product_id ?? null,
  })) as Record<string, unknown>;
  const status = excluded ? "excluded" : findings.some((finding) => finding.severity === "blocker") ? "blocked" : "eligible";
  return {
    order_id: orderId,
    status,
    operation_at: operationAt,
    operation_local_date: localDate,
    order_code: orderCode,
    payment_reference: text(order.out_trade_no) || null,
    description: recipe?.name ?? (text(order.product_name) || null),
    units: Number.isFinite(units) ? units : null,
    gross_cents: breakdown?.grossCents ?? null,
    tax_base_cents: breakdown?.baseCents ?? null,
    vat_cents: breakdown?.vatCents ?? null,
    recipe_id: recipe?.id ?? null,
    odoo_product_id: recipe?.odoo_finished_product_id ?? null,
    refund_required: refundRequired,
    refund_reference: text(order.refund_out_no) || null,
    findings,
    source_snapshot: sourceSnapshot,
    source_sha256: sha256(sourceSnapshot),
  };
}

export function summarizeFiscalPreflight(items: FiscalPreflightItem[]) {
  const eligible = items.filter((item) => item.status === "eligible");
  const money = eligible.reduce((totals, item) => ({
    gross_cents: totals.gross_cents + (item.gross_cents ?? 0),
    tax_base_cents: totals.tax_base_cents + (item.tax_base_cents ?? 0),
    vat_cents: totals.vat_cents + (item.vat_cents ?? 0),
  }), { gross_cents: 0, tax_base_cents: 0, vat_cents: 0 });
  return {
    selected_orders: items.length,
    eligible_invoices: eligible.length,
    blocked_orders: items.filter((item) => item.status === "blocked").length,
    excluded_orders: items.filter((item) => item.status === "excluded").length,
    refunds_requiring_review: items.filter((item) => item.refund_required && item.status !== "excluded").length,
    warning_findings: items.flatMap((item) => item.findings).filter((finding) => finding.severity === "warning").length,
    ...money,
  };
}
