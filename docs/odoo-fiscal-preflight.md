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
  "company": {
    "country_code": "ES",
    "vat": "ESB12345678",
    "currency": "EUR"
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
    "rate": 10
  },
  "products": [
    {
      "odoo_product_id": 101,
      "sale_ok": true,
      "income_account_code": "701000",
      "sale_tax_rates": [10]
    }
  ]
}
```

`income_account_code` must be the effective account after product/category fallback. `sale_tax_rates` must contain the effective customer taxes. The connector should submit every active finished product referenced by a platform recipe.

## Control behavior

- Platform operators choose inclusive Madrid-local dates. The platform stores a half-open UTC range.
- Completed sales become invoice candidates. Administrative/test operations are recorded as excluded.
- Every candidate must resolve to exactly one active recipe and one Odoo finished product.
- Gross amounts are converted to integer cents. For 10% tax included in price, base cents are `round(gross_cents / 1.10)` and VAT is the residual.
- Full-refund evidence remains a warning requiring review. The first release cannot infer partial refunds and never mutates a source invoice.
- Candidate totals above EUR 3,000 are blocked by the vending simplified-invoice control.
- A report older than 24 hours blocks the overall preflight.
- `tax_treatment_approved` starts as `false`; an accountant must approve the 10% treatment before a run can be ready.
- `posting_enabled` is initialized to `false` and there is no platform operation that changes it.

Before implementing invoice execution, obtain accountant approval for product VAT eligibility and historical accounting/tax dates, enable secure posted-entry hashes in Odoo, and add a separate durable document-request contract with idempotent result callbacks.
