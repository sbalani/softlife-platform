# Huaxin Status Shadow

This worker compares live Huaxin status reads with the current production snapshots. It writes only to `huaxin_status_shadow_runs` and `huaxin_status_shadow_results`; it does not update machine state, alerts, orders, or menus.

The Huaxin certificate cannot be validated by the hosted Edge runtime, so the pilot uses the read-only `/api/internal/huaxin-status` transport bridge. Deployment requires the same randomly generated `HUAXIN_STATUS_BRIDGE_TOKEN` in Vercel production and Supabase Edge secrets. The bridge only accepts the status-detail operation.

The migration does not configure a project URL, select targets, or create a schedule. Deployment must explicitly call `configure_huaxin_status_shadow`, insert at most two pilot targets, and invoke `trigger_huaxin_status_shadow` after both transports are live.
