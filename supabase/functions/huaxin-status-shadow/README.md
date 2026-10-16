# Huaxin Status Worker

This worker fetches Huaxin machine status and records every run in `huaxin_status_shadow_runs` and `huaxin_status_shadow_results`. Its database configuration supports two rollout modes:

- `shadow` compares live responses with production snapshots without changing them.
- `authoritative` persists snapshots and alert observations atomically through `ingest_huaxin_machine_status`.

`configure_huaxin_status_worker(mode, target_scope)` controls whether the worker is read-only or authoritative and whether it processes the pilot target table or every deployed machine. New environments start in `shadow`/`targets` mode.

The Huaxin certificate cannot be validated by the hosted Edge runtime, so the worker uses the narrow `/api/internal/huaxin-status` transport bridge. Deployment requires the same randomly generated `HUAXIN_STATUS_BRIDGE_TOKEN` in Vercel production and Supabase Edge secrets. The bridge only accepts the status-detail operation.

`configure_huaxin_status_shadow_schedule(true)` runs the worker at minutes 7 and 37 of every hour; pass `false` to stop it without removing audit history. The historical function and table names retain `shadow` to avoid replacing deployed Vault and cron configuration during promotion.
