# Huaxin Status Shadow

This worker compares live Huaxin status reads with the current production snapshots. It writes only to `huaxin_status_shadow_runs` and `huaxin_status_shadow_results`; it does not update machine state, alerts, orders, or menus.

The Huaxin certificate cannot be validated by the hosted Edge runtime, so the pilot uses the read-only `/api/internal/huaxin-status` transport bridge. Deployment requires the same randomly generated `HUAXIN_STATUS_BRIDGE_TOKEN` in Vercel production and Supabase Edge secrets. The bridge only accepts the status-detail operation.

The initial migration does not configure a project URL or select targets. Deployment must explicitly call `configure_huaxin_status_shadow` and insert at most two pilot targets after both transports are live. Once configured, `configure_huaxin_status_shadow_schedule(true)` runs the read-only comparison at minutes 7 and 37 of every hour; pass `false` to stop it without removing the worker or its audit history. Fresh environments without the Vault configuration leave the schedule disabled during migration.
