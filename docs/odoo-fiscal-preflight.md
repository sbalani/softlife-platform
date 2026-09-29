# Odoo fiscal preflight contract

The platform's first fiscal-invoicing release is intentionally read-only. It freezes Huaxin source sales, VAT calculations, product mappings, findings, and the latest Odoo configuration report. It does not expose an invoice queue, draft creation, release, or posting operation.

## Connector endpoints

The connector authenticates exactly like the existing internal Odoo routes.

- `GET /api/internal/odoo/fiscal-configuration` returns the platform's expected journal, customer, tax rate, currency, income account, and posting state.
- `POST /api/internal/odoo/fiscal-configuration` appends an immutable configuration report. Reports are never updated in place.

Example report:

```json
{
  "contract_version": 1,
  "checked_at": "2026-09-29T12:00:00Z",
  "capabilities": { "fiscal_product_remediation": 1 },
  "company": {
    "odoo_id": 3,
    "country_code": "ES",
    "vat": "ESB12345678",
    "currency": "EUR"
  },
  "income_account": {
    "odoo_id": 77,
    "code": "701000",
    "account_type": "income"
  },
  "journal": {
    "code": "VEND",
    "type": "sale",
    "refund_sequence": true,
    "secure_posted_entries": false
  },
  "customer": {
    "odoo_id": 722,
    "country_code": "ES",
    "vat": null
  },
  "tax": {
    "odoo_id": 41,
    "type_tax_use": "sale",
    "rate": 10,
    "country_code": "ES",
    "price_include": true,
    "amount_type": "percent"
  },
  "products": [
    {
      "odoo_product_id": 101,
      "sale_ok": true,
      "income_account_code": "701000",
      "sale_tax_rates": [10],
      "sale_tax_country_codes": ["ES"],
      "sale_tax_ids": [41],
      "sale_taxes": [
        { "odoo_tax_id": 41, "rate": 10, "country_code": "ES", "price_include": true, "amount_type": "percent", "type_tax_use": "sale" }
      ]
    }
  ]
}
```

`income_account_code` must be the effective account after product/category and customer fiscal-position mapping. Tax fields must describe the effective customer taxes after fiscal-position mapping. `price_include` may be true or false; later draft creation must derive the Odoo line price so the final gross remains the amount actually charged. The connector should submit every active finished product referenced by a platform recipe.

## Control behavior

- Platform operators choose inclusive Madrid-local dates. The platform stores a half-open UTC range.
- Completed sales become invoice candidates. Administrative/test operations are recorded as excluded.
- Every candidate must resolve to exactly one active recipe and one Odoo finished product.
- Gross amounts are converted to integer cents. For 10% tax included in price, base cents are `round(gross_cents / 1.10)` and VAT is the residual.
- Full-refund evidence remains a warning requiring review. The first release cannot infer partial refunds and never mutates a source invoice.
- Candidate totals above EUR 3,000 are blocked by the vending simplified-invoice control.
- A report older than 24 hours blocks the overall preflight.
- `tax_treatment_approved` records the confirmed 10% treatment for the current vending products. Operations began in July 2026 and no Modelo 303 period had been filed when this treatment was approved.
- `posting_enabled` is initialized to `false` and there is no platform operation that changes it.

Before implementing invoice execution, resolve historical accounting/tax dates, enable secure posted-entry hashes in Odoo, and add a separate durable document-request contract with idempotent result callbacks. Reconfirm VAT eligibility only when adding or changing vending products.

## Fiscal product remediation

The upgraded connector advertises `capabilities.fiscal_product_remediation = 1` and reports exact company, income-account, tax, customer, and effective product configuration identifiers. The `/odoo` admin screen derives distinct candidates only from active recipe `odoo_finished_product_id` values present in the latest immutable report. It uses the same effective income-account and Spanish percentage sales-tax predicates as fiscal preflight.

Queueing is blocked when the report is older than 24 hours, its top-level fiscal configuration is not accepted, exact target identifiers or expected values are invalid, an active recipe product is absent from the report, no product needs a change, or another remediation request is pending or processing. The server action accepts only the displayed report ID/hash and acknowledgement; it reloads the latest report, settings, recipes, and request state and recomputes the candidates.

`odoo_sync_requests` stores the canonical payload and SHA-256 under kind `fiscal_product_remediation`. Source fields are immutable after insertion. Existing `stock_snapshot` requests remain payload-free and are read independently by the stock UI. Connector claim and lease-based idempotent completion behavior is unchanged; claimed rows now include `kind`, `payload`, and `payload_sha256`.

The remediation payload can update only the listed products' income account and/or customer taxes according to each boolean flag. This operation cannot create or post invoices.
