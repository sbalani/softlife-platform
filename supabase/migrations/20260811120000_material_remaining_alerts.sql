UPDATE public.alerts alert
SET resolved_at = now()
FROM public.change_alert_rules rule
WHERE alert.change_alert_rule_id = rule.id
  AND alert.resolved_at IS NULL
  AND rule.name = 'Material shortage'
  AND rule.field = 'material_empty'
  AND rule.machine_id IS NULL
  AND rule.product_id IS NULL;

UPDATE public.change_alert_rules
SET enabled = false
WHERE name = 'Material shortage'
  AND field = 'material_empty'
  AND machine_id IS NULL
  AND product_id IS NULL;

CREATE OR REPLACE FUNCTION public.evaluate_material_remaining_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  current_pct NUMERIC;
  machine_tenant UUID;
  subject TEXT;
BEGIN
  IF NEW.field <> 'material_remaining_pct' OR NEW.new_value IS NULL OR NEW.machine_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    current_pct := NEW.new_value #>> '{}';
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NEW;
  END;

  subject := COALESCE(NEW.machine_name, NEW.device_imei, 'Machine');
  IF current_pct <= 25 THEN
    SELECT tenant_id INTO machine_tenant FROM public.machines WHERE id = NEW.machine_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.alerts
      WHERE type = 'material_remaining_critical'
        AND machine_id = NEW.machine_id
        AND resolved_at IS NULL
    ) THEN
      INSERT INTO public.alerts (
        tenant_id, type, severity, machine_id, entity_key, message,
        remaining_pct, change_log_id
      ) VALUES (
        machine_tenant, 'material_remaining_critical', 'critical', NEW.machine_id,
        'status_0_sellcup', subject || ' has ' || current_pct ||
        '% of post-shortage cups remaining before OOS.', current_pct, NEW.id
      );
    ELSE
      UPDATE public.alerts
      SET remaining_pct = current_pct,
          message = subject || ' has ' || current_pct ||
            '% of post-shortage cups remaining before OOS.',
          change_log_id = NEW.id
      WHERE type = 'material_remaining_critical'
        AND machine_id = NEW.machine_id
        AND resolved_at IS NULL;
    END IF;
  ELSE
    UPDATE public.alerts
    SET resolved_at = now()
    WHERE type = 'material_remaining_critical'
      AND machine_id = NEW.machine_id
      AND resolved_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machine_material_remaining_alert ON public.machine_change_log;
CREATE TRIGGER machine_material_remaining_alert
AFTER INSERT ON public.machine_change_log
FOR EACH ROW EXECUTE FUNCTION public.evaluate_material_remaining_alert();
