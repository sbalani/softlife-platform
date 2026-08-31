CREATE OR REPLACE VIEW public.v_alerts
WITH (security_invoker = true)
AS
SELECT a.id, a.type, a.severity, a.title, a.message, a.remaining_pct, a.created_at,
       COALESCE(m.display_name, m.name) AS machine_name, p.name AS product_name,
       a.machine_id, a.product_id, a.change_log_id, a.change_alert_rule_id, a.resolved_at,
       COALESCE(c.device_imei, m.device_imei) AS device_imei,
       c.field AS change_field, COALESCE(a.entity_key, c.entity_key) AS entity_key,
       m.deployed AS machine_deployed, a.resolved_by
FROM public.alerts a
LEFT JOIN public.machines m ON m.id = a.machine_id
LEFT JOIN public.products p ON p.id = a.product_id
LEFT JOIN public.machine_change_log c ON c.id = a.change_log_id;
