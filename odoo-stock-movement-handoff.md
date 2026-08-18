# Odoo Stock Movement Handoff

Phase 2 keeps `odoo_lot_stock` as the imported Odoo baseline and records all
platform receipts, transfers, corrections, refill allocations, and reversals in
the append-only `warehouse_stock_movements` ledger.

## Authentication

Set the same `ODOO_SYNC_SECRET` in the platform and the external Odoo worker.
Send it in `x-odoo-sync-secret` for every endpoint below.

## Claim Work

`POST /api/internal/odoo/stock-movements/claim`

```json
{ "worker": "unique-lease-owner", "limit": 20 }
```

The response contains movement rows, `movement_group_id`, and a per-claim
`lease_token`. Rows sharing a non-null group are one atomic Odoo transfer. Use
each returned `external_reference` (`softlife:` for individual movements and
`softlife-transfer:` for transfer legs) as an idempotency key, and execute a
transfer group as one Odoo operation.

## Record Result

`POST /api/internal/odoo/stock-movements/result`

```json
{
  "movement_id": "uuid-from-claim",
  "worker": "unique-lease-owner",
  "lease_token": "uuid-from-claim",
  "accepted": true,
  "odoo_external_id": "odoo-move-or-picking-id"
}
```

One result transitions the complete transfer group. For retryable failures,
set `accepted` to `false`, include `error`, and provide `retry_at`. Omit
`retry_at` only for a terminal visible failure.

Acceptance does not remove the platform stock overlay. It moves the command to
`accepted_awaiting_mirror` until an Odoo snapshot explicitly acknowledges it.

## Import Snapshot

`POST /api/internal/odoo/lot-stock-snapshot`

```json
{
  "rows": [
    { "odoo_lot_id": 123, "odoo_warehouse_id": 7, "qty": 10 }
  ],
  "reflected_references": ["softlife:movement-uuid"]
}
```

`reflected_references` must contain only platform references observed in the
same Odoo state represented by `rows`. Snapshot replacement and reference
reconciliation are atomic. The legacy `replace_odoo_lot_stock(p_rows)` RPC is
still accepted during migration, but it cannot acknowledge platform movements;
the worker must move to this endpoint to prevent conservative double deduction.

Positive receipts and transfer-ins do not become allocatable before mirror
acknowledgement. Negative movements reserve stock immediately. This guarantees
that a delayed or failed Odoo synchronization cannot fabricate availability.
