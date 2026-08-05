CREATE OR REPLACE VIEW public.v_alerts
WITH (security_invoker = true)
AS
SELECT a.id, a.type, a.severity, a.message, a.remaining_pct, a.created_at,
       COALESCE(m.display_name, m.name) AS machine_name, p.name AS product_name,
       a.machine_id, a.product_id, a.change_log_id, a.change_alert_rule_id, a.resolved_at,
       COALESCE(c.device_imei, m.device_imei) AS device_imei,
       c.field AS change_field, COALESCE(a.entity_key, c.entity_key) AS entity_key
FROM public.alerts a
LEFT JOIN public.machines m ON m.id = a.machine_id
LEFT JOIN public.products p ON p.id = a.product_id
LEFT JOIN public.machine_change_log c ON c.id = a.change_log_id;

GRANT SELECT ON public.v_alerts TO authenticated;

ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS push_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS alerts_pending_push_idx
  ON public.alerts (created_at)
  WHERE resolved_at IS NULL AND push_notified_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobile_push_tokens_user_idx ON public.mobile_push_tokens (user_id);
ALTER TABLE public.mobile_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_push_tokens FROM anon, authenticated;

INSERT INTO public.change_alert_rules (name, field, rule_type, target_value, severity)
SELECT rule.name, rule.field, 'status_equals', rule.target_value, rule.severity
FROM (VALUES
  ('Material shortage', 'material_empty', 'true', 'critical'),
  ('Cup shortage', 'cup_empty', 'true', 'critical'),
  ('Machine offline', 'device_online', 'false', 'warning'),
  ('Foreign object in cup holder', 'cup_foreign_object', 'true', 'critical'),
  ('Ordering system fault', 'ordering_system_fault', 'true', 'critical'),
  ('Cup dispenser blocked', 'cup_blocked', 'true', 'warning'),
  ('Cup pickup fault', 'cup_take_fault', 'true', 'warning')
) AS rule(name, field, target_value, severity)
WHERE NOT EXISTS (
  SELECT 1 FROM public.change_alert_rules existing
  WHERE existing.field = rule.field
    AND existing.machine_id IS NULL
    AND existing.product_id IS NULL
);
