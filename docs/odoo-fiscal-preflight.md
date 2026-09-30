# Odoo fiscal invoice contract

The platform creates simplified customer sales invoices from immutable fiscal preflights. It does not create franchisee vendor bills. Source sales, configuration evidence, invoice payloads, hashes, Odoo identities, and every queue transition remain durable and auditable.

## Configuration report

The connector uses the existing internal Odoo authentication.

- `GET /api/internal/odoo/fiscal-configuration` returns the expected journal, final-consumer customer, VAT rate, currency, income account, and legacy posting state.
- `POST /api/internal/odoo/fiscal-configuration` appends an immutable report. Reports are never updated in place.
- Invoice execution requires `capabilities.fiscal_invoice_draft_creation = 1`, `capabilities.fiscal_invoice_bulk_confirmation = 1`, and a supported `capabilities.fiscal_zero_value_invoices` version. Version 1 supports Free and Admin override vends; version 2 also supports coupon (`串码支付`) vends.
- The report referenced by the ready preflight must be accepted and no more than 24 hours old when drafts are queued.

Example report:

```json
{
  "contract_version": 1,
  "checked_at": "2026-09-29T12:00:00Z",
  "capabilities": {
    "fiscal_product_remediation": 1,
    "fiscal_invoice_draft_creation": 1,
    "fiscal_invoice_bulk_confirmation": 1,
    "fiscal_zero_value_invoices": 2
  },
  "company": { "odoo_id": 3, "country_code": "ES", "vat": "ESB12345678", "currency": "EUR" },
  "income_account": { "odoo_id": 77, "code": "701000", "account_type": "income" },
  "journal": { "code": "VEND", "type": "sale", "refund_sequence": true, "secure_posted_entries": false },
  "customer": { "odoo_id": 722, "country_code": "ES", "vat": null },
  "tax": { "odoo_id": 41, "type_tax_use": "sale", "rate": 10, "country_code": "ES", "price_include": true, "amount_type": "percent" },
  "products": [{
    "odoo_product_id": 101,
    "sale_ok": true,
    "income_account_code": "701000",
    "sale_tax_rates": [10],
    "sale_tax_country_codes": ["ES"],
    "sale_tax_ids": [41],
    "sale_taxes": [{ "odoo_tax_id": 41, "rate": 10, "country_code": "ES", "price_include": true, "amount_type": "percent", "type_tax_use": "sale" }]
  }]
}
```

The income account and taxes are the effective values after product/category defaults and the customer fiscal position. The connector reports every active finished product referenced by a platform recipe.
`price_include` may be either `true` or `false`. For an included tax, Odoo derives the line unit price from the frozen gross amount; for an excluded tax, it derives the line unit price from the frozen tax base. In both cases the resulting invoice total must equal `expected_total_cents`.

## Preflight controls

- Operators select inclusive Madrid-local dates; storage uses an exact half-open UTC period and immutable local source dates.
- Completed non-administrative sales are candidates. Each candidate resolves to one active recipe and Odoo finished product.
- Gross, tax base, and VAT use exact integer cents. At 10% included VAT, base cents are `round(gross_cents / 1.10)` and VAT is the residual.
- A simplified-invoice candidate above EUR 3,000 is blocked.
- Refund evidence remains a warning for review. A warning sale cannot enter invoice execution.
- `tax_treatment_approved` must be true. The existing `posting_enabled` database lock remains unchanged and is not the confirmation gate.

## Draft creation

An admin explicitly acknowledges the latest ready preflight. The server reloads that run, every item, its exact configuration report, and current settings. It rejects blocked runs, no eligible sales, refund warnings, stale or incapable reports, missing Odoo identifiers, and batches above 500 invoices. Client-supplied accounting configuration is never trusted.

One eligible sale creates one `out_invoice` contract document and one durable `fiscal_invoice_documents` row. The platform UUID is the idempotency identity. Each invoice has one line containing the Odoo product, description, quantity, exact gross/base/VAT cents, and Odoo tax ID. The invoice SHA-256 is calculated over canonical JSON before `invoice_payload_sha256` is added; the outer SHA-256 covers the complete canonical payload.

Completed Huaxin Free, Admin override, and coupon (`串码支付`) vends remain eligible with their product quantity and immutable source evidence, but use zero gross, tax-base, and VAT cents. A zero total from any other payment type remains blocked as invalid source data.

```json
{
  "contract_version": 1,
  "configuration_report_id": "uuid",
  "configuration_payload_sha256": "sha256",
  "company": { "odoo_id": 3, "country_code": "ES", "currency": "EUR" },
  "journal": { "code": "VEND" },
  "customer": { "odoo_id": 722 },
  "tax": { "odoo_tax_id": 41, "rate": 10, "country_code": "ES", "type_tax_use": "sale", "amount_type": "percent", "price_include": true },
  "invoices": [{
    "platform_invoice_id": "uuid",
    "invoice_payload_sha256": "sha256",
    "move_type": "out_invoice",
    "invoice_date": "2026-09-29",
    "currency": "EUR",
    "reference": "provider-or-order-reference",
    "expected_total_cents": 380,
    "zero_value_reason": null,
    "lines": [{ "odoo_product_id": 101, "description": "Frozen yogurt", "quantity": 1, "gross_cents": 380, "tax_base_cents": 345, "vat_cents": 35, "odoo_tax_id": 41 }]
  }]
}
```

Accepted draft results contain exactly one unique result per requested platform UUID: `platform_invoice_id`, positive `odoo_move_id`, matching `invoice_payload_sha256`, `state: "draft"`, and boolean `created`. Draft creation never authorizes posting. Platform IDs must belong to the exact request payload, and Odoo move IDs must be unique across both the response and all fiscal invoice documents. Unknown, missing, duplicate, posted, or hash-mismatched results reject the callback transaction before any document update.

If draft creation fails, the batch and all documents retain their source reservation in `failed`/`draft_failed`. An admin can explicitly retry. Retry creates a new leased queue request from the batch's exact immutable payload and hash, preserving every original platform invoice UUID. `draft_request_id` remains the immutable first attempt and `latest_draft_request_id` identifies the attempt currently allowed to complete.

## Confirmation

The admin selects exact platform document UUIDs currently in `draft` state and explicitly acknowledges posting. Selection may contain multiple documents, and remaining drafts can be confirmed in later requests. The RPC proves bidirectional set equality between the selected UUIDs and payload UUIDs and rejects duplicates before changing status. The server reloads all selected rows and queues only their trusted Odoo move IDs and hashes:

```json
{
  "contract_version": 1,
  "company": { "odoo_id": 3 },
  "invoices": [{ "platform_invoice_id": "uuid", "odoo_move_id": 91, "invoice_payload_sha256": "sha256" }]
}
```

Accepted confirmation results must exactly cover the request with matching identity fields, `state: "posted"`, a nonempty Odoo invoice `name`, and boolean `confirmed`. Only selected rows transition to `confirmation_pending` and then `posted`.

## Durability and connector behavior

- `fiscal_invoice_batches` records source preflight/report IDs, UTC and inclusive local periods, status, queue IDs, frozen draft payload/hash, errors, and audit timestamps.
- `fiscal_invoice_documents` records immutable preflight item/order identity, platform UUID, source and invoice hashes, exact cents, Odoo product/tax/date/reference, and returned Odoo move state/name.
- One source order can appear in only one fiscal invoice document.
- A GiST exclusion constraint prevents overlapping timestamp periods for all non-cancelled batches. Failed batches retain their source reservation.
- Tables and transactional RPCs are service-role-only. Preflight immutability and existing v1 stock/remediation requests are unchanged.
- Connector workers claim requests through `GET /api/internal/odoo/sync-requests` and complete the lease through `POST /api/internal/odoo/sync-requests/{requestId}/result`.
- An identical callback with the same lease remains idempotent. Rejected connector results preserve the batch and record an actionable failed state/error.
- Odoo must independently gate `fiscal_invoice_bulk_confirmation`; the platform does not weaken or toggle `posting_enabled`.

The `/odoo` admin calendar displays the inclusive processed ranges and status. The database exclusion constraint, not the calendar, is the authoritative overlap control.

## Product remediation

`fiscal_product_remediation` remains a separate version 1 queue operation. It can update only the frozen products' effective income account and/or customer taxes and cannot create or post invoices.
