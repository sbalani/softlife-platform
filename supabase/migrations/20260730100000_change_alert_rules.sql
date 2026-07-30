ALTER TABLE public.alerts ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.alerts ADD COLUMN change_log_id UUID REFERENCES public.machine_change_log(id) ON DELETE SET NULL;
ALTER TABLE public.alerts ADD COLUMN change_alert_rule_id UUID;
ALTER TABLE public.alerts ADD COLUMN resolved_at TIMESTAMPTZ;
ALTER TABLE public.alerts ADD COLUMN resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE public.change_alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  field TEXT NOT NULL,
  machine_id UUID REFERENCES public.machines(id) ON DELETE CASCADE,
  min_value NUMERIC,
  max_value NUMERIC,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_change_alert_rule_id_fkey
  FOREIGN KEY (change_alert_rule_id) REFERENCES public.change_alert_rules(id) ON DELETE SET NULL;

CREATE INDEX change_alert_rules_lookup_idx ON public.change_alert_rules (field, machine_id) WHERE enabled;
CREATE UNIQUE INDEX alerts_change_rule_log_idx ON public.alerts (change_alert_rule_id, change_log_id)
  WHERE change_alert_rule_id IS NOT NULL AND change_log_id IS NOT NULL;
CREATE INDEX alerts_unresolved_idx ON public.alerts (resolved_at, created_at DESC);

ALTER TABLE public.change_alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY change_alert_rules_admin_all ON public.change_alert_rules
  FOR ALL TO authenticated
  USING ((SELECT public.is_current_admin()))
  WITH CHECK ((SELECT public.is_current_admin()));

CREATE OR REPLACE FUNCTION public.evaluate_change_alert_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  numeric_value NUMERIC;
  rule public.change_alert_rules%ROWTYPE;
  machine_tenant UUID;
  subject TEXT;
  allowed_range TEXT;
BEGIN
  IF NEW.field IS NULL OR NEW.new_value IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    numeric_value := (NEW.new_value #>> '{}')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NEW;
  END;

  IF NEW.machine_id IS NOT NULL THEN
    SELECT tenant_id INTO machine_tenant FROM public.machines WHERE id = NEW.machine_id;
  END IF;
  subject := COALESCE(NEW.machine_name, NEW.device_imei, NEW.metadata->>'product_name', NEW.entity_key, 'Unknown item');

  FOR rule IN
    SELECT * FROM public.change_alert_rules
    WHERE enabled
      AND field = NEW.field
      AND (machine_id IS NULL OR machine_id = NEW.machine_id)
      AND ((min_value IS NOT NULL AND numeric_value < min_value)
        OR (max_value IS NOT NULL AND numeric_value > max_value))
  LOOP
    allowed_range := CASE
      WHEN rule.min_value IS NOT NULL AND rule.max_value IS NOT NULL THEN rule.min_value || ' to ' || rule.max_value
      WHEN rule.min_value IS NOT NULL THEN 'at least ' || rule.min_value
      ELSE 'at most ' || rule.max_value
    END;
    INSERT INTO public.alerts (
      tenant_id, type, severity, machine_id, message, change_log_id, change_alert_rule_id
    ) VALUES (
      machine_tenant,
      'change_out_of_range',
      rule.severity,
      NEW.machine_id,
      subject || ': ' || replace(NEW.field, '_', ' ') || ' changed to ' || numeric_value ||
        ', outside rule "' || rule.name || '" (' || allowed_range || ').',
      NEW.id,
      rule.id
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER machine_change_log_alert_rules
AFTER INSERT ON public.machine_change_log
FOR EACH ROW EXECUTE FUNCTION public.evaluate_change_alert_rules();

CREATE OR REPLACE VIEW public.v_alerts
WITH (security_invoker = true)
AS
SELECT a.id, a.type, a.severity, a.message, a.remaining_pct, a.created_at,
       m.name AS machine_name, a.machine_id, a.change_log_id, a.change_alert_rule_id,
       a.resolved_at, c.device_imei, c.field AS change_field, c.entity_key
FROM public.alerts a
LEFT JOIN public.machines m ON m.id = a.machine_id
LEFT JOIN public.machine_change_log c ON c.id = a.change_log_id;
