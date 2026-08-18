# Action Report Plan

Recovered from the project conversation history on 2026-08-18. This is the
canonical plan for the Action Report feature. It is separate from the existing
machine Change Log.

## Problem

The current workflow incorrectly treats these as one transaction:

1. The physical service happened.
2. The refill lot and warehouse provenance are known.
3. Inventory is available and synchronized.

Missing warehouse stock can therefore block a real refill and can roll back a
valid cleaning recorded in the same visit. Physical facts must be persisted
immediately and inventory provenance reconciled separately.

## Action Report

Replace the operational refill form with one Action Report supporting:

- Cleaning only.
- Refill only.
- Cleaning and refill.
- Other service actions.
- Historical event date and time.
- Written notes.
- Voice recording and transcription.
- General photos.
- Before/after cleaning photos.
- Batch/lot photos associated with refill lines.
- Draft and confirmed states.

The existing `/refills` URL may remain for compatibility but should become the
unified Action Report page. Existing mobile endpoints remain operational while
a versioned API is introduced.

## Unresolved Refills

A physical refill can be confirmed even when:

- No warehouse inventory is recorded.
- The lot is missing from inventory.
- The transfer into the warehouse has not been entered.
- Available stock is insufficient.
- The exact lot is not yet known.

Each refill line has one provenance status:

- `unresolved`
- `partially_resolved`
- `resolved`
- `voided`

Unresolved provenance must not fabricate stock or make authoritative inventory
negative. Historical refills, including the two known La Marquesa 1888 refills,
can be entered immediately as completed physical actions with visible inventory
provenance gaps.

## Inventory Backfill

- Add warehouse receipt, transfer, and correction actions to the platform.
- Record them in an append-only inventory movement ledger.
- Never overwrite historical movements.
- Synchronize platform adjustments to Odoo.
- Keep Odoo synchronization status visible.
- Avoid double-counting if Odoo later incorporates a platform adjustment.
- Propose matching allocations when stock becomes available.
- Require user confirmation before an allocation changes inventory or closes a
  provenance gap.

## Canonical Data Model

- `service_action_reports`
- `service_action_refill_lines`
- `service_action_attachments`
- `service_action_questions`
- `refill_stock_allocations`
- `warehouse_stock_movements`
- `machine_warehouse_assignments`

Separation of responsibilities:

- An Action Report records what physically happened.
- Refill lines record what was physically loaded.
- Stock allocations record where it came from.
- Warehouse movements record how stock entered or moved between warehouses.
- Questions track missing or ambiguous operational information.
- Cleaning and refill synchronization failures are independent.

Existing `clean_logs`, `reposiciones`, and `lot_usages` remain compatibility
tables and are linked or dual-written during migration.

## Lot Traceability Audit

Keep `/lot-audit`, but explain that it:

- Tracks which lots were loaded into which machines.
- Supports recalls and traceability.
- Does not by itself prove warehouse provenance is reconciled.
- Shows unresolved physical refills whose inventory source remains outstanding.
- Treats Odoo synchronization separately from platform acceptance.

Expand the audit with operator, Action Report, assigned warehouse, observed and
confirmed lot, physical/allocated/outstanding quantities, provenance status,
Odoo status, and recorded time versus actual event time. Add a dedicated
Provenance Gaps view.

## Voice And AI Workflow

1. User creates an Action Report draft.
2. Browser or mobile app records audio.
3. Audio uploads directly to private Supabase Storage.
4. A background worker transcribes it.
5. AI extracts cleaning, refill, other actions, notes, quantities, lots, and
   follow-up details.
6. Deterministic validation identifies missing or ambiguous fields.
7. The UI asks focused questions.
8. The user reviews and explicitly confirms.
9. The physical report is saved even if inventory provenance remains unresolved.

AI must not:

- Invent machine, lot, warehouse, or user identifiers.
- Automatically confirm ambiguous quantities.
- Bypass machine authorization.
- Submit without user confirmation.
- Treat missing inventory as proof that the refill did not happen.

Raw audio is retained privately with audited access and short-lived signed URLs.
The UI includes a recording/privacy notice.

## Photos

New evidence is stored in a private bucket. Support general report photos,
before/after cleaning photos, batch-code photos linked to refill lines, and
manual or AI-suggested captions. New reports must not store images as base64 in
`payload_json` or use the existing public refill-photo model.

## Delivery Phases

### Phase 1: Immediate Operational Unblock

- Add canonical Action Reports and refill lines.
- Permit unresolved refill provenance.
- Separate cleaning persistence from inventory validation.
- Support historical report times.
- Add notes and private photos.
- Add the Lot Traceability Audit explanation and gap statuses.
- Enter the two historical La Marquesa refills.

### Phase 2: Inventory Reconciliation

- Add platform warehouse receipts, transfers, and corrections.
- Add the unresolved-provenance queue.
- Suggest matching stock allocations.
- Require confirmation before closing gaps.
- Add Odoo synchronization and double-count protection.

### Phase 3: Voice And AI

- Add private audio uploads.
- Add asynchronous transcription.
- Add structured AI extraction.
- Add deterministic missing-field questions.
- Add review and explicit confirmation.
- Retain audio with the final report.

### Phase 4: Mobile Migration

- Add versioned Action Report APIs.
- Preserve existing refill and cleaning endpoints through adapters.
- Support offline drafts and attachment uploads.
- Update the mobile handoff contract.
- Move mobile photos away from base64.

## Required Tests

- Cleaning persists when refill provenance is missing.
- Historical refills can be recorded idempotently.
- Unresolved lines do not alter warehouse availability.
- Allocations cannot exceed physical refill quantity.
- Confirmed allocations cannot exceed available stock.
- Platform receipts and transfers reconcile without double-counting Odoo.
- Duplicate offline submissions remain idempotent.
- Audio and photo objects remain private.
- AI drafts cannot submit without confirmation.
- Ambiguous machine, lot, and quantity values generate questions.
- Existing mobile endpoints remain compatible.
- Recall searches include unresolved observed lot codes.

Implementation must be additive. Do not unblock refills by weakening existing
stock checks or allowing negative authoritative inventory.
