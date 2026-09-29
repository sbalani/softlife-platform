import {
  evaluateFiscalConfiguration,
  fiscalProductRemediationNeeds,
  type FiscalProductCheck,
  type FiscalSettings,
} from "./odoo-fiscal-preflight.ts";
import { sha256 } from "./odoo-sync-contract.ts";

export type FiscalRemediationRecipe = {
  name: string;
  odoo_finished_product_id: number | null;
};

export type FiscalRemediationRequest = {
  id: string;
  status: string;
  requested_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  attempts: number;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type FiscalRemediationProduct = {
  odoo_product_id: number;
  names: string[];
  observed_income_account_code: string | null;
  observed_sale_taxes: FiscalProductCheck["sale_taxes"];
  remediate_income_account: boolean;
  remediate_customer_taxes: boolean;
};

export type FiscalRemediationPayload = {
  contract_version: 1;
  configuration_report_id: string;
  configuration_payload_sha256: string;
  company: { odoo_id: number; country_code: string; currency: string };
  customer: { odoo_id: number };
  target: {
    income_account: { odoo_id: number; code: string; account_type: string };
    sale_tax: { odoo_tax_id: number; rate: number; country_code: string; type_tax_use: string; amount_type: string; price_include: boolean };
  };
  products: { odoo_product_id: number; remediate_income_account: boolean; remediate_customer_taxes: boolean }[];
};

export type FiscalRemediationPreview = {
  available: boolean;
  report: { id: string; checked_at: string; payload_sha256: string } | null;
  blockers: string[];
  missingProducts: { odoo_product_id: number; names: string[] }[];
  products: FiscalRemediationProduct[];
  target: FiscalRemediationPayload["target"] | null;
  payload: FiscalRemediationPayload | null;
  payloadSha256: string | null;
  latestRequest: FiscalRemediationRequest | null;
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

export function buildFiscalRemediationPreview(input: {
  settings: FiscalSettings;
  report: { id: string; checked_at: string; accepted: boolean; payload_sha256: string; payload: Record<string, unknown> } | null;
  recipes: FiscalRemediationRecipe[];
  latestRequest?: FiscalRemediationRequest | null;
  hasActiveRequest?: boolean;
  now?: number;
}): FiscalRemediationPreview {
  const { settings, report, recipes, latestRequest = null, now = Date.now() } = input;
  const blockers: string[] = [];
  const base = { available: true, report: report ? { id: report.id, checked_at: report.checked_at, payload_sha256: report.payload_sha256 } : null, latestRequest };
  if (!report) return { ...base, blockers: ["No Odoo fiscal configuration report is available."], missingProducts: [], products: [], target: null, payload: null, payloadSha256: null };

  const evaluation = evaluateFiscalConfiguration(settings, report.payload);
  const capabilities = record(report.payload.capabilities);
  const company = record(report.payload.company);
  const customer = record(report.payload.customer);
  const incomeAccount = record(report.payload.income_account);
  const tax = record(report.payload.tax);
  const checkedAt = Date.parse(report.checked_at);
  const companyId = positiveInteger(company.odoo_id);
  const accountId = positiveInteger(incomeAccount.odoo_id);
  const taxId = positiveInteger(tax.odoo_id);
  const taxRate = Number(tax.rate);
  const countryCode = text(company.country_code).toUpperCase();
  const currency = text(company.currency).toUpperCase();
  const accountCode = text(incomeAccount.code);
  const accountType = text(incomeAccount.account_type);
  const taxCountryCode = text(tax.country_code).toUpperCase();
  const taxUse = text(tax.type_tax_use);
  const amountType = text(tax.amount_type);

  if (!report.accepted || !evaluation.accepted) blockers.push("The latest Odoo report does not have an accepted top-level fiscal configuration.");
  if (!Number.isFinite(checkedAt) || now - checkedAt > 24 * 60 * 60_000 || checkedAt > now + 5 * 60_000) blockers.push("The latest Odoo fiscal configuration report must be no more than 24 hours old.");
  if (Number(capabilities.fiscal_product_remediation) !== 1) blockers.push("The Odoo connector has not advertised fiscal product remediation capability 1.");
  if (!companyId || countryCode !== "ES" || currency !== settings.currency) blockers.push("The report must identify the exact Spanish Odoo company in the configured currency.");
  if (positiveInteger(customer.odoo_id) !== settings.customer_odoo_id) blockers.push("The report does not identify the configured final-consumer customer.");
  if (!accountId || accountCode !== settings.income_account_code || !["income", "income_other"].includes(accountType)) blockers.push("The report does not identify a valid target income account with the configured code and account type.");
  if (!taxId || !Number.isFinite(taxRate) || Math.abs(taxRate - settings.vat_rate) >= 0.0001
    || taxCountryCode !== "ES" || taxUse !== "sale" || amountType !== "percent" || typeof tax.price_include !== "boolean") {
    blockers.push("The report does not identify the exact configured Spanish percentage sales tax.");
  }
  if (!/^[0-9a-f]{64}$/.test(report.payload_sha256) || sha256(report.payload) !== report.payload_sha256) blockers.push("The immutable Odoo report payload does not match its recorded SHA-256.");

  const namesById = new Map<number, Set<string>>();
  for (const recipe of recipes) {
    const id = positiveInteger(recipe.odoo_finished_product_id);
    if (!id) continue;
    const names = namesById.get(id) ?? new Set<string>();
    names.add(recipe.name);
    namesById.set(id, names);
  }
  const reportedById = new Map(evaluation.products.map((product) => [product.odoo_product_id, product]));
  const missingProducts = [...namesById.entries()]
    .filter(([id]) => !reportedById.has(id))
    .map(([odoo_product_id, names]) => ({ odoo_product_id, names: [...names].sort() }))
    .sort((a, b) => a.odoo_product_id - b.odoo_product_id);
  if (missingProducts.length) blockers.push("One or more active recipe products are missing from the latest Odoo report.");

  const products = [...namesById.entries()].flatMap(([id, names]) => {
    const product = reportedById.get(id);
    if (!product) return [];
    const needs = fiscalProductRemediationNeeds(product, settings);
    return needs.remediate_income_account || needs.remediate_customer_taxes ? [{
      odoo_product_id: id,
      names: [...names].sort(),
      observed_income_account_code: product.income_account_code,
      observed_sale_taxes: product.sale_taxes,
      ...needs,
    }] : [];
  }).sort((a, b) => a.odoo_product_id - b.odoo_product_id);
  if (!products.length) blockers.push("No active recipe products require fiscal remediation.");
  const hasActiveRequest = input.hasActiveRequest ?? Boolean(latestRequest && ["pending", "processing"].includes(latestRequest.status));
  if (hasActiveRequest) blockers.push("A fiscal product remediation request is already active.");

  const target = companyId && accountId && taxId && Number.isFinite(taxRate) && typeof tax.price_include === "boolean" ? {
    income_account: { odoo_id: accountId, code: accountCode, account_type: accountType },
    sale_tax: { odoo_tax_id: taxId, rate: taxRate, country_code: taxCountryCode, type_tax_use: taxUse, amount_type: amountType, price_include: tax.price_include },
  } : null;
  const payload: FiscalRemediationPayload | null = blockers.length || !target || !companyId ? null : {
    contract_version: 1,
    configuration_report_id: report.id,
    configuration_payload_sha256: report.payload_sha256,
    company: { odoo_id: companyId, country_code: countryCode, currency },
    customer: { odoo_id: settings.customer_odoo_id },
    target,
    products: products.map((product) => ({
      odoo_product_id: product.odoo_product_id,
      remediate_income_account: product.remediate_income_account,
      remediate_customer_taxes: product.remediate_customer_taxes,
    })),
  };
  return { ...base, blockers, missingProducts, products, target, payload, payloadSha256: payload ? sha256(payload) : null };
}
