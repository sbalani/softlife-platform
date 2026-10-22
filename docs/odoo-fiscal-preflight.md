# Odoo fiscal invoice contract

The platform creates simplified customer sales invoices from immutable fiscal preflights. It does not create franchisee vendor bills. Source sales, configuration evidence, invoice payloads, hashes, Odoo identities, and every queue transition remain durable and auditable.

## Configuration report

The connector uses the existing internal Odoo authentication.

- `GET /api/internal/odoo/fiscal-configuration` returns the expected journal, final-consumer customer, VAT rate, currency, income account, and legacy posting state.
- `POST /api/internal/odoo/fiscal-configuration` appends an immutable report. Reports are never updated in place.
- Legacy invoice execution accepts `capabilities.fiscal_invoice_draft_creation >= 1` and `capabilities.fiscal_invoice_bulk_confirmation >= 1`. Batches containing zero-value invoices also require a supported `capabilities.fiscal_zero_value_invoices` version: version 1 supports Free and Admin override vends, while version 2 or newer also supports coupon (`串码支付`) vends.
- Post-cutover execution requires exactly `capabilities.fiscal_invoice_allocation_v2 = 1` and `capabilities.manufacturing_transaction_sales = 1`. Included zero-value sources additionally require `fiscal_zero_value_invoices >= 1`, or `>= 2` for coupons.
- The report referenced by the ready preflight must be accepted. Reports older than 24 hours are disclosed at execution while their exact accepted identity and hash remain enforced.

Example report:

```json
{
  "contract_version": 1,
  "checked_at": "2026-09-29T12:00:00Z",
  "capabilities": {
    "fiscal_product_remediation": 1,
    "fiscal_invoice_draft_creation": 1,
    "fiscal_invoice_bulk_confirmation": 1,
    "fiscal_zero_value_invoices": 2,
    "fiscal_invoice_allocation_v2": 1,
    "manufacturing_transaction_sales": 1
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
`price_include` must be `true`. Vending source prices are immutable gross consumer amounts; a price-included tax lets Odoo reproduce the exact rounded tax base, VAT, and invoice total for every EUR-cent amount.

## Preflight controls

- Operators select inclusive Madrid-local dates; storage uses an exact half-open UTC period and immutable local source dates.
- Completed non-administrative sales are candidates. Each candidate resolves to one active recipe and Odoo finished product.
- Gross, tax base, and VAT use exact integer cents. At 10% included VAT, base cents are `round(gross_cents / 1.10)` and VAT is the residual.
- A simplified-invoice candidate above EUR 3,000 is blocked.
- Refund evidence remains a warning for review. Refund-review sales are omitted from draft execution and their skipped count is recorded.
- `tax_treatment_approved` must be true. The existing `posting_enabled` database lock remains unchanged and is not the confirmation gate.

## Draft creation

### September 2026 cutover

The immutable Madrid-local transaction date selects the contract. Transactions through 2026-08-31 retain fiscal contract v1. Transactions from 2026-09-01 use fiscal contract v2; mixed ranges are rejected. A v2 preflight must cover one complete, already closed `Europe/Madrid` calendar month.

An admin records an accepted customer request against its source order before freezing the month. The legal name, tax ID, email, address, postal code, city, province, country, canonical hash, actor, and acceptance time are immutable. Only one request can be accepted for an order.

Manufacturing contract v3 retains `payload_contract_version: 2` because its recipe schema remains v2, and identifies its transaction extension separately with `manufacturing_contract_version: 3`. Its frozen `connector_capabilities` are returned unchanged. It creates one supporting Odoo sales order and line for every transaction while preserving aggregate manufacturing orders. Each transaction sales order carries `recipe_version_id`, and each recipe aggregate carries `gross_sales_cents`, calculated as the sum of its per-order rounded `expected_total_cents`; the legacy decimal `gross_sales` field remains present. Its accepted callback must exactly cover the frozen platform order IDs and hashes. The durable `manufacturing_sale_order_documents` mapping is required by fiscal v2.

```json
{
  "recipes": [{ "recipe_version_id": "uuid", "gross_sales": 1.005, "gross_sales_cents": 101 }],
  "sales_orders": [{ "platform_order_id": "uuid", "recipe_version_id": "uuid", "expected_total_cents": 101 }]
}
```

Fiscal v2 excludes refunded/refund-review transactions and administrative non-sales before supporting-SO validation; they never enter an individual or consolidated invoice and never receive a fiscal payload allocation. This remains true when a refund is recorded after manufacturing created its supporting sales order: the platform's current source state is authoritative. Database queue validation requires exact allocation coverage of every non-excluded eligible source, not excluded refunds. Legacy fiscal v1 classification remains unchanged. Fiscal v2 freezes the accepted request and supporting SO mapping into every eligible preflight item. The supporting mapping's `source_sha256` must still equal the source order's current `export_content_hash` both when the preflight is frozen and when it is queued. The allocation payload exposes this independently as `supporting_sale_order_source_sha256`; its existing `source_sha256` remains the fiscal preflight snapshot hash. A stale manufacturing mapping blocks the month.

```json
{
  "source_order_id": "uuid",
  "source_sha256": "fiscal-preflight-sha256",
  "supporting_sale_order_id": "uuid",
  "supporting_sale_order_source_sha256": "manufacturing-export-content-sha256"
}
```

Fiscal v2 creates one individual invoice for each requested order and exactly one monthly consolidated invoice for every remaining transaction. Each source transaction has one immutable `fiscal_invoice_source_allocations` row and one invoice line linked to its supporting Odoo SO line. The consolidated invoice header always has `zero_value_reason: null`, including when it has only one zero-value source; each line retains its source reason. The consolidated invoice UUID, allocations, lines, customer identity, and hashes remain stable across retries. Legacy fiscal sale-link processing reads only contract v1 documents.

Fiscal v2 intentionally fail-closes when a month would exceed 500 accounting documents or 5,000 total source/allocation lines across requested individual and consolidated invoices. These are supported monthly bounds; fiscal v2 does not partition an oversized month into sequential requests. Canonical draft payloads are bounded to 8,000,000 UTF-8 bytes, fiscal connector results and confirmation payloads to 500,000 bytes, and manufacturing v3 payloads/results to 5,000,000 bytes. The application and database both enforce these limits before reserving or completing work. Result-size constraints are introduced `NOT VALID` so historical rows are not scanned, while all new or changed rows remain constrained.

An admin explicitly selects and acknowledges one immutable preflight. The displayed rows, CSV, execution preview, and queued source always use that same run ID. Fiscal v2 is whole-month fail-closed: if any source row is blocked, no eligible row from that month can execute. The source must be corrected and a replacement monthly preflight frozen before creating any drafts. Excluded non-sales remain disclosed separately.

Global configuration blockers remain non-bypassable. The server also rejects no invoiceable sales, incompatible connector capabilities, missing or mismatched Odoo identifiers, concurrent draft requests, duplicate source use, and overlapping invoice jobs. Legacy fiscal v1 jobs partition sales deterministically into sequential connector requests of at most 500 invoices. Fiscal v2 instead enforces its monthly fail-closed document and source-line bounds. Report age is shown as a warning at execution time because the exact accepted report identity and hash remain enforced. Client-supplied accounting configuration is never trusted.

Under contract v1, one eligible sale creates one `out_invoice` contract document and one durable `fiscal_invoice_documents` row. The platform UUID is the idempotency identity. Each invoice has one line containing the Odoo product, description, quantity, exact gross/base/VAT cents, and Odoo tax ID. The invoice SHA-256 is calculated over canonical JSON before `invoice_payload_sha256` is added; the outer SHA-256 covers the complete canonical payload.

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

The confirmation envelope uses the same contract version as its frozen draft batch, so fiscal v2 batches are confirmed with `contract_version: 2`.

## Durability and connector behavior

- `fiscal_invoice_jobs` reserves one source preflight and period, records skipped-row decisions, and aggregates draft/posting progress. Legacy completed batches are backfilled as one-batch jobs without changing their documents or Odoo identities.
- `fiscal_invoice_batches` records frozen payloads/hashes, queue IDs, status, errors, and audit timestamps. Legacy v1 may contain ordered internal requests of at most 500 invoices and releases them sequentially. Fiscal v2 creates one bounded monthly request and fails closed rather than partitioning an oversized month.
- `fiscal_invoice_documents` records the contract version, invoice mode, platform UUID, invoice hash, exact cents, tax/date/reference, and returned Odoo move state/name. V1 retains direct source identity; v2 uses authoritative allocations.
- One source order can appear in only one active v1 document or v2 allocation.
- A GiST exclusion constraint prevents overlapping timestamp periods for all non-cancelled jobs. Failed jobs retain their source reservation.
- Tables and transactional RPCs are service-role-only. Preflight immutability and existing v1 stock/remediation requests are unchanged.
- Connector workers claim requests through `GET /api/internal/odoo/sync-requests` and complete the lease through `POST /api/internal/odoo/sync-requests/{requestId}/result`.
- An identical callback with the same lease remains idempotent. Rejected connector results preserve the batch and record an actionable failed state/error.
- Odoo must independently gate `fiscal_invoice_bulk_confirmation`; the platform does not weaken or toggle `posting_enabled`.

The `/odoo` admin calendar displays the inclusive processed ranges and status. The database exclusion constraint, not the calendar, is the authoritative overlap control.

## Product remediation

`fiscal_product_remediation` remains a separate version 1 queue operation. It can update only the frozen products' effective income account and/or customer taxes and cannot create or post invoices.
