ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS entity_key TEXT;

UPDATE public.alerts a
SET entity_key = c.entity_key
FROM public.machine_change_log c
WHERE c.id = a.change_log_id;

CREATE INDEX IF NOT EXISTS alerts_rule_scope_idx
  ON public.alerts (change_alert_rule_id, machine_id, product_id, entity_key)
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.evaluate_change_alert_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  numeric_value NUMERIC;
  text_value TEXT;
  rule public.change_alert_rules%ROWTYPE;
  machine_tenant UUID;
  product_name TEXT;
  subject TEXT;
  allowed_range TEXT;
  matches BOOLEAN;
BEGIN
  IF NEW.field IS NULL OR NEW.new_value IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.machine_id IS NOT NULL THEN
    SELECT tenant_id INTO machine_tenant FROM public.machines WHERE id = NEW.machine_id;
  END IF;
  IF NEW.product_id IS NOT NULL THEN
    SELECT name INTO product_name FROM public.products WHERE id = NEW.product_id;
  END IF;
  subject := CONCAT_WS(' on ',
    COALESCE(product_name, NEW.metadata->>'product_name', NEW.entity_key, replace(NEW.field, '_', ' ')),
    COALESCE(NEW.machine_name, NEW.device_imei)
  );
  text_value := NEW.new_value #>> '{}';

  FOR rule IN
    SELECT * FROM public.change_alert_rules
    WHERE enabled
      AND field = NEW.field
      AND (machine_id IS NULL OR machine_id = NEW.machine_id)
      AND (product_id IS NULL OR product_id = NEW.product_id)
  LOOP
    IF rule.rule_type = 'numeric_range' THEN
      BEGIN
        numeric_value := text_value::NUMERIC;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        CONTINUE;
      END;
      matches := (rule.min_value IS NOT NULL AND numeric_value < rule.min_value)
        OR (rule.max_value IS NOT NULL AND numeric_value > rule.max_value);
      allowed_range := CASE
        WHEN rule.min_value IS NOT NULL AND rule.max_value IS NOT NULL THEN rule.min_value || ' to ' || rule.max_value
        WHEN rule.min_value IS NOT NULL THEN 'at least ' || rule.min_value
        ELSE 'at most ' || rule.max_value
      END;
    ELSE
      matches := text_value = rule.target_value;
      allowed_range := rule.target_value;
    END IF;

    IF matches THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.alerts a
        WHERE a.change_alert_rule_id = rule.id
          AND a.machine_id IS NOT DISTINCT FROM NEW.machine_id
          AND a.product_id IS NOT DISTINCT FROM NEW.product_id
          AND a.entity_key IS NOT DISTINCT FROM NEW.entity_key
          AND a.resolved_at IS NULL
      ) THEN
        INSERT INTO public.alerts (
          tenant_id, type, severity, machine_id, product_id, entity_key, message,
          change_log_id, change_alert_rule_id
        ) VALUES (
          machine_tenant,
          CASE WHEN rule.rule_type = 'numeric_range' THEN 'value_out_of_range' ELSE 'status_changed' END,
          rule.severity,
          NEW.machine_id,
          NEW.product_id,
          NEW.entity_key,
          CASE
            WHEN rule.rule_type = 'numeric_range' THEN subject || ': ' || replace(NEW.field, '_', ' ') ||
              ' is ' || numeric_value || ', outside rule "' || rule.name || '" (' || allowed_range || ').'
            ELSE subject || ': ' || replace(NEW.field, '_', ' ') ||
              ' changed to ' || text_value || ', matching rule "' || rule.name || '".'
          END,
          NEW.id,
          rule.id
        );
      END IF;
    ELSE
      UPDATE public.alerts
      SET resolved_at = now()
      WHERE change_alert_rule_id = rule.id
        AND machine_id IS NOT DISTINCT FROM NEW.machine_id
        AND product_id IS NOT DISTINCT FROM NEW.product_id
        AND entity_key IS NOT DISTINCT FROM NEW.entity_key
        AND resolved_at IS NULL;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP VIEW public.v_alerts;
CREATE VIEW public.v_alerts
WITH (security_invoker = true)
AS
SELECT a.id, a.type, a.severity, a.message, a.remaining_pct, a.created_at,
       m.name AS machine_name, p.name AS product_name, a.machine_id, a.product_id,
       a.change_log_id, a.change_alert_rule_id, a.resolved_at,
       c.device_imei, c.field AS change_field, COALESCE(a.entity_key, c.entity_key) AS entity_key
FROM public.alerts a
LEFT JOIN public.machines m ON m.id = a.machine_id
LEFT JOIN public.products p ON p.id = a.product_id
LEFT JOIN public.machine_change_log c ON c.id = a.change_log_id;

GRANT SELECT ON public.v_alerts TO authenticated;
