ALTER TABLE public.machine_change_log
  ADD COLUMN product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.change_alert_rules
  ADD COLUMN product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'numeric_range'
    CHECK (rule_type IN ('numeric_range', 'status_equals')),
  ADD COLUMN target_value TEXT;

ALTER TABLE public.alerts
  ADD COLUMN product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN entity_key TEXT;

ALTER TABLE public.change_alert_rules DROP CONSTRAINT change_alert_rules_check;
ALTER TABLE public.change_alert_rules DROP CONSTRAINT change_alert_rules_check1;
ALTER TABLE public.change_alert_rules ADD CONSTRAINT change_alert_rules_values_check CHECK (
  (rule_type = 'numeric_range' AND target_value IS NULL
    AND (min_value IS NOT NULL OR max_value IS NOT NULL)
    AND (min_value IS NULL OR max_value IS NULL OR min_value <= max_value))
  OR
  (rule_type = 'status_equals' AND target_value IS NOT NULL
    AND min_value IS NULL AND max_value IS NULL)
);

CREATE INDEX machine_change_log_product_field_idx
  ON public.machine_change_log (product_id, field, created_at DESC);
CREATE INDEX change_alert_rules_scope_idx
  ON public.change_alert_rules (field, machine_id, product_id) WHERE enabled;
CREATE INDEX change_alert_rules_product_id_idx ON public.change_alert_rules (product_id);
CREATE INDEX alerts_product_id_idx ON public.alerts (product_id);
CREATE INDEX alerts_rule_scope_idx ON public.alerts (change_alert_rule_id, machine_id, product_id, entity_key) WHERE resolved_at IS NULL;

UPDATE public.machine_change_log
SET product_id = entity_key::UUID
WHERE entity_type = 'product'
  AND entity_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = entity_key::UUID);

CREATE TABLE public.machine_status_snapshots (
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value JSONB NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (machine_id, field)
);

ALTER TABLE public.machine_status_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_status_snapshots FROM anon, authenticated;

DELETE FROM public.huaxin_temperatures a
USING public.huaxin_temperatures b
WHERE a.id > b.id
  AND a.machine_id IS NOT DISTINCT FROM b.machine_id
  AND a.reading_time = b.reading_time
  AND a.series_name IS NOT DISTINCT FROM b.series_name;

ALTER TABLE public.huaxin_temperatures
  ADD CONSTRAINT huaxin_temperatures_machine_time_series_key
  UNIQUE (machine_id, reading_time, series_name);

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

CREATE OR REPLACE FUNCTION public.log_temperature_for_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  machine_row public.machines%ROWTYPE;
BEGIN
  IF NEW.machine_id IS NULL OR NEW.value IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO machine_row FROM public.machines WHERE id = NEW.machine_id;
  INSERT INTO public.machine_change_log (
    machine_id, device_imei, machine_name, source, action, entity_type,
    entity_key, field, new_value, metadata
  ) VALUES (
    NEW.machine_id, machine_row.device_imei, machine_row.name, 'machine_sync',
    'observed', 'temperature', COALESCE(NEW.series_name, 'temperature'),
    'temperature', to_jsonb(NEW.value), jsonb_build_object(
      'series_name', NEW.series_name,
      'reading_time', NEW.reading_time
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER huaxin_temperature_alert_event
AFTER INSERT ON public.huaxin_temperatures
FOR EACH ROW EXECUTE FUNCTION public.log_temperature_for_alerts();

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
