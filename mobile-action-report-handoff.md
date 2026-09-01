# Mobile Action Report V2 Handoff

Status date: 2026-08-18

The canonical mobile workflow replaces separate refill/full-cleaning writes with
offline-capable Action Reports. Existing endpoints remain accepted during the
migration, but now persist through the same canonical report RPC.

## Capabilities And Cache

New capabilities returned by login/refresh:

- `action_reports.write`
- `action_reports.attach`

Production profile `scope_version` is incremented by the backend migration.
When capabilities or scope version changes, clear protected report, machine,
warehouse-lot, and attachment caches before applying the new session.

## Offline Sync

`POST /softlife/v2/action-reports/sync`

Maximum 50 records per request. Send sequential chunks and commit each response
before sending the next.

```json
{
  "records": [
    {
      "client_uuid": "stable-offline-uuid",
      "machine_id": "machine-uuid",
      "occurred_at": "2026-08-18T12:00:00Z",
      "status": "draft",
      "revision": 0,
      "action_kind": "both",
      "notes": "Optional notes",
      "cleaning": {
        "material_used": true,
        "water_buckets": 3
      },
      "refill_lines": [
        {
          "quantity": 1,
          "unit": "bag",
          "odoo_lot_id": 123,
          "lot_code": "LOT-123",
          "product_name": "Mix"
        }
      ]
    }
  ]
}
```

Use `draft` while incomplete and resend the same `client_uuid` and the latest
server `revision` as fields are edited. A new record uses revision `0`; each
accepted change returns the next revision. An identical network retry remains
idempotent, while a stale conflicting edit is rejected for user resolution.
The raw mobile draft payload is retained so incomplete lines are not lost.
Send `confirmed` only after explicit user review. A confirmed UUID is
immutable; an identical retry is accepted and a conflicting retry is rejected.

The response is record-level:

```json
{
  "accepted": [
    {
      "client_uuid": "...",
      "report_id": "...",
      "status": "draft",
      "revision": 1,
      "provenance_status": "unresolved"
    }
  ],
  "rejected": [{ "client_uuid": "...", "reason": "..." }]
}
```

Missing warehouse, transfer, lot, or stock provenance does not reject a
physical refill. It returns unresolved or partially resolved provenance.

`GET /softlife/v2/action-reports/sync` returns up to 100 currently authorized server drafts owned by
the current user, including lines, attachment metadata, `updated_at`, and
`scope_version`. Merge by `client_uuid`; do not overwrite a newer local edit
without user review.

## Private Attachments

Do not put base64 images or audio in report JSON.

1. Request upload:
   `POST /softlife/v2/action-reports/{report_id}/attachments/upload`

   ```json
   { "mime_type": "image/jpeg", "size_bytes": 123456 }
   ```

2. Upload bytes directly to Supabase Storage with the returned `path` and
   `token` using `uploadToSignedUrl`. The token expires in two hours.

3. Finalize:
   `POST /softlife/v2/action-reports/{report_id}/attachments/complete`

   ```json
   {
     "path": "returned-path",
     "mime_type": "image/jpeg",
     "refill_line_id": "optional-server-line-uuid"
   }
   ```

   Photos may be finalized while the report is either `draft` or `confirmed`.
   Audio remains draft-only. Attachment lifecycle conflicts return HTTP 409 with
   a stable `error.code`; invalid uploads return 400 and storage outages return
   502. A photo linked to a refill line freezes that line's evidence-bearing
   content while preserving the existing draft-to-confirmed rebind behavior.

For audio, omit `refill_line_id`. Audio requires a draft and starts private
transcription/extraction. Inform the user that retained audio is sent to OpenAI
for processing and requires explicit review; AI never confirms the report.

Poll `GET /softlife/v2/action-reports/{report_id}/ai` for transcript,
structured extraction, deterministic questions, and status. Apply accepted
values to the local draft, synchronize that draft revision, then call
`POST /softlife/v2/action-reports/{report_id}/ai` with:

```json
{ "decision": "reviewed", "answers": { "question_key": "user answer" } }
```

Every open question requires an answer. To abandon queued or completed AI work,
send `{ "decision": "discard" }`. Active processing must finish before either
decision. Confirmation is blocked atomically until review or discard completes.

Download a private attachment through:

`GET /softlife/v2/action-reports/attachments/{attachment_id}`

The response contains a 60-second signed URL. Do not persist that URL.

Supported attachments are JPEG, PNG, WebP, HEIC, WebM audio, M4A/MP4 audio,
MP3, and WAV, up to 20 MB each.

## Legacy Compatibility

These existing routes and response shapes remain available:

- `POST /softlife/reposicion/sync`
- `POST /softlife/service-visits/sync`
- `POST /softlife/machines/{id}/clean-log`

Numeric Odoo lots, legacy UUID lots, batch size 50, and accepted/rejected arrays
remain supported. Legacy UUID-lot records retain their original inventory and
base64 compatibility path. New releases should stop embedding `batch_photo` base64 and
use V2 signed attachments. Partial cleaning remains on the legacy clean-log
path; full cleaning and refills use canonical Action Reports.
