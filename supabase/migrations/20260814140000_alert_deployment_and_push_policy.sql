ALTER TABLE public.machines
  ADD COLUMN deployed BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.change_alert_rules
  ADD COLUMN series_name TEXT,
  ADD COLUMN notify_mobile BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.alerts
  ADD COLUMN mobile_notification BOOLEAN NOT NULL DEFAULT false;

UPDATE public.change_alert_rules
SET notify_mobile = true
WHERE severity = 'critical'
  AND field IN ('cup_empty', 'cup_foreign_object', 'ordering_system_fault', 'mixture_ratio_fault', 'stock');

CREATE OR REPLACE FUNCTION public.normalize_temperature_series(raw_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN regexp_replace(lower(trim(COALESCE(raw_name, ''))), '[^a-z0-9]+', '', 'g') LIKE '%precool%'
      OR regexp_replace(lower(trim(COALESCE(raw_name, ''))), '[^a-z0-9]+', '', 'g') LIKE '%preenfri%'
      THEN 'pre-cooling'
    ELSE lower(trim(COALESCE(raw_name, '')))
  END;
$$;

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
  machine_label TEXT;
  machine_deployed BOOLEAN := true;
  product_name TEXT;
  current_series TEXT;
  alert_title TEXT;
  alert_message TEXT;
  matches BOOLEAN;
BEGIN
  IF NEW.field IS NULL OR NEW.new_value IS NULL THEN RETURN NEW; END IF;

  IF NEW.machine_id IS NOT NULL THEN
    SELECT tenant_id, COALESCE(display_name, name, device_imei), deployed
    INTO machine_tenant, machine_label, machine_deployed
    FROM public.machines WHERE id = NEW.machine_id;
    IF NOT COALESCE(machine_deployed, false) THEN RETURN NEW; END IF;
  END IF;
  IF NEW.product_id IS NOT NULL THEN
    SELECT name INTO product_name FROM public.products WHERE id = NEW.product_id;
  END IF;
  machine_label := COALESCE(machine_label, NEW.machine_name, NEW.device_imei, 'Machine');
  text_value := NEW.new_value #>> '{}';
  current_series := CASE WHEN NEW.field = 'temperature'
    THEN public.normalize_temperature_series(COALESCE(NEW.metadata->>'series_name', NEW.entity_key))
    ELSE NULL END;

  FOR rule IN
    SELECT * FROM public.change_alert_rules
    WHERE enabled
      AND field = NEW.field
      AND (machine_id IS NULL OR machine_id = NEW.machine_id)
      AND (product_id IS NULL OR product_id = NEW.product_id)
      AND (series_name IS NULL OR public.normalize_temperature_series(series_name) = current_series)
  LOOP
    IF rule.rule_type = 'numeric_range' THEN
      BEGIN numeric_value := text_value::NUMERIC;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN CONTINUE;
      END;
      matches := (rule.min_value IS NOT NULL AND numeric_value < rule.min_value)
        OR (rule.max_value IS NOT NULL AND numeric_value > rule.max_value);
    ELSE
      matches := text_value = rule.target_value;
    END IF;

    IF matches AND NEW.field = 'device_online' AND NOT EXISTS (
      SELECT 1 FROM public.machine_status_snapshots snapshot
      WHERE snapshot.machine_id = NEW.machine_id
        AND snapshot.field = 'device_online'
        AND snapshot.value #>> '{}' = 'false'
    ) THEN CONTINUE;
    END IF;

    alert_title := CASE NEW.field
      WHEN 'cup_empty' THEN 'Cups empty'
      WHEN 'device_online' THEN 'Machine offline'
      WHEN 'cup_foreign_object' THEN 'Foreign object detected'
      WHEN 'cup_blocked' THEN 'Cup dispenser blocked'
      WHEN 'cup_take_fault' THEN 'Cup not collected'
      WHEN 'mixture_ratio_fault' THEN 'Insufficient mixture proportion'
      WHEN 'ordering_system_fault' THEN 'Unrecognized machine fault'
      WHEN 'stock' THEN 'Product unavailable'
      WHEN 'temperature' THEN CASE WHEN current_series = 'pre-cooling' THEN 'Pre-cooling temperature high' ELSE 'Temperature out of range' END
      ELSE 'Machine needs attention'
    END;
    alert_message := CASE NEW.field
      WHEN 'cup_empty' THEN 'The machine reports no cups and may be unable to sell. Refill the cup dispenser.'
      WHEN 'device_online' THEN 'No Huaxin connection was reported in two consecutive checks. Current sales status is unknown.'
      WHEN 'cup_foreign_object' THEN 'A foreign object was detected in the cup holder. Inspect and clear the cup area.'
      WHEN 'cup_blocked' THEN 'The cup dispenser reports a blockage. Inspect the dispenser before the next sale.'
      WHEN 'cup_take_fault' THEN 'A prepared cup may still be waiting for collection. Check the dispensing area.'
      WHEN 'mixture_ratio_fault' THEN 'The machine cannot maintain the configured mixture proportion. Inspect the product supply.'
      WHEN 'ordering_system_fault' THEN 'Huaxin reported ' || COALESCE(NEW.metadata->>'raw_value', 'an unknown operating state') || '. Inspect the machine.'
      WHEN 'stock' THEN COALESCE(product_name, NEW.metadata->>'product_name', NEW.entity_key, 'A product') || ' stock counter reached zero. The product is unavailable for sale.'
      WHEN 'temperature' THEN COALESCE(initcap(current_series), 'Temperature') || ' is ' || numeric_value || '°C'
        || CASE WHEN rule.max_value IS NOT NULL THEN ', above the ' || rule.max_value || '°C maximum.' ELSE ', outside the allowed range.' END
        || ' Check refrigeration immediately.'
      ELSE 'The machine reported a condition that needs attention.'
    END;

    IF matches THEN
      UPDATE public.alerts alert
      SET title = alert_title, message = alert_message, change_log_id = NEW.id,
          mobile_notification = rule.notify_mobile
      WHERE alert.change_alert_rule_id = rule.id
        AND alert.machine_id IS NOT DISTINCT FROM NEW.machine_id
        AND alert.product_id IS NOT DISTINCT FROM NEW.product_id
        AND alert.entity_key IS NOT DISTINCT FROM NEW.entity_key
        AND alert.resolved_at IS NULL;
      IF NOT FOUND THEN
        INSERT INTO public.alerts (
          tenant_id, type, severity, machine_id, product_id, entity_key,
          title, message, change_log_id, change_alert_rule_id, mobile_notification
        ) VALUES (
          machine_tenant, NEW.field, rule.severity, NEW.machine_id, NEW.product_id,
          NEW.entity_key, alert_title, alert_message, NEW.id, rule.id, rule.notify_mobile
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

CREATE OR REPLACE FUNCTION public.evaluate_material_remaining_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  current_pct NUMERIC;
  machine_tenant UUID;
  machine_deployed BOOLEAN;
  counter TEXT;
  counts TEXT[];
  remaining_cups INTEGER;
  total_cups INTEGER;
  alert_title TEXT;
  alert_message TEXT;
BEGIN
  IF NEW.field <> 'material_remaining_pct' OR NEW.new_value IS NULL OR NEW.machine_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id, deployed INTO machine_tenant, machine_deployed FROM public.machines WHERE id = NEW.machine_id;
  IF NOT COALESCE(machine_deployed, false) THEN RETURN NEW; END IF;
  BEGIN current_pct := NEW.new_value #>> '{}';
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NEW;
  END;

  counter := COALESCE(NEW.metadata->>'raw_value', '');
  counts := regexp_match(counter, '^(\d+)\s*\[\s*(\d+)\s*]');
  IF counts IS NOT NULL THEN remaining_cups := counts[1]::INTEGER; total_cups := counts[2]::INTEGER; END IF;

  IF current_pct <= 25 THEN
    alert_title := CASE WHEN current_pct = 0 THEN 'Material exhausted' ELSE 'Material critically low' END;
    alert_message := CASE
      WHEN current_pct = 0 THEN 'No post-shortage sales remain. The machine should have stopped selling.'
      WHEN remaining_cups IS NOT NULL THEN remaining_cups || ' of ' || total_cups || ' post-shortage sales remain. Refill soon.'
      ELSE current_pct || '% of post-shortage sales remain. Refill soon.'
    END;
    UPDATE public.alerts alert
    SET title = alert_title, message = alert_message, remaining_pct = current_pct,
        change_log_id = NEW.id, mobile_notification = current_pct = 0,
        push_notified_at = CASE WHEN current_pct = 0 AND alert.remaining_pct > 0 THEN NULL ELSE alert.push_notified_at END
    WHERE alert.type = 'material_remaining_critical' AND alert.machine_id = NEW.machine_id AND alert.resolved_at IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.alerts (
        tenant_id, type, severity, machine_id, entity_key, title, message,
        remaining_pct, change_log_id, mobile_notification
      ) VALUES (
        machine_tenant, 'material_remaining_critical', 'critical', NEW.machine_id,
        'material_remaining_pct', alert_title, alert_message, current_pct, NEW.id, current_pct = 0
      );
    END IF;
  ELSE
    UPDATE public.alerts SET resolved_at = now()
    WHERE type = 'material_remaining_critical' AND machine_id = NEW.machine_id AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_alerts_when_undeployed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.deployed AND NOT NEW.deployed THEN
    UPDATE public.alerts SET resolved_at = now()
    WHERE machine_id = NEW.id AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER machine_undeployed_resolves_alerts
AFTER UPDATE OF deployed ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.resolve_alerts_when_undeployed();

CREATE OR REPLACE VIEW public.v_machines
WITH (security_invoker = true)
AS
SELECT
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at, m.location, m.location_override, m.latitude, m.longitude,
  m.is_online AS net_online, cust.name AS customer, wh.name AS warehouse,
  prod.name AS base_product,
  (SELECT count(*) FROM public.machine_ingredients mi WHERE mi.machine_id = m.id) AS ingredient_count,
  (SELECT t.value FROM public.huaxin_temperatures t WHERE t.machine_id = m.id ORDER BY t.reading_time DESC, t.id DESC LIMIT 1) AS latest_temp,
  m.huaxin_last_sync, m.deployed
FROM public.machines m
LEFT JOIN public.tenants cust ON cust.id = m.customer_id
LEFT JOIN public.warehouses wh ON wh.id = m.warehouse_id
LEFT JOIN public.products prod ON prod.id = m.base_product_id;

CREATE OR REPLACE VIEW public.v_alerts
WITH (security_invoker = true)
AS
SELECT a.id, a.type, a.severity, a.title, a.message, a.remaining_pct, a.created_at,
       COALESCE(m.display_name, m.name) AS machine_name, p.name AS product_name,
       a.machine_id, a.product_id, a.change_log_id, a.change_alert_rule_id, a.resolved_at,
       COALESCE(c.device_imei, m.device_imei) AS device_imei,
       c.field AS change_field, COALESCE(a.entity_key, c.entity_key) AS entity_key,
       m.deployed AS machine_deployed
FROM public.alerts a
LEFT JOIN public.machines m ON m.id = a.machine_id
LEFT JOIN public.products p ON p.id = a.product_id
LEFT JOIN public.machine_change_log c ON c.id = a.change_log_id;

DROP FUNCTION public.claim_pending_alert_pushes(INTEGER);
CREATE FUNCTION public.claim_pending_alert_pushes(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID, severity TEXT, machine_id UUID, title TEXT, message TEXT,
  created_at TIMESTAMPTZ, machine_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE public.alerts alert
    SET push_notified_at = now()
    WHERE alert.id IN (
      SELECT pending.id FROM public.alerts pending
      LEFT JOIN public.machines machine ON machine.id = pending.machine_id
      WHERE pending.resolved_at IS NULL
        AND pending.push_notified_at IS NULL
        AND pending.mobile_notification
        AND (pending.machine_id IS NULL OR machine.deployed)
      ORDER BY pending.created_at
      FOR UPDATE OF pending SKIP LOCKED
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    RETURNING alert.id, alert.severity, alert.machine_id, alert.title, alert.message, alert.created_at
  )
  SELECT claimed.id, claimed.severity, claimed.machine_id, claimed.title,
         claimed.message, claimed.created_at, COALESCE(machine.display_name, machine.name)
  FROM claimed LEFT JOIN public.machines machine ON machine.id = claimed.machine_id;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_alert_pushes(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_alert_pushes(INTEGER) TO service_role;

INSERT INTO public.change_alert_rules (
  name, field, series_name, rule_type, max_value, severity, notify_mobile, enabled
)
SELECT 'Pre-cooling above 10°C', 'temperature', 'pre-cooling', 'numeric_range', 10, 'critical', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.change_alert_rules
  WHERE field = 'temperature' AND public.normalize_temperature_series(series_name) = 'pre-cooling'
);

INSERT INTO public.machine_change_log (
  machine_id, device_imei, machine_name, source, action, entity_type,
  entity_key, field, new_value, metadata
)
SELECT latest.machine_id, machine.device_imei, COALESCE(machine.display_name, machine.name),
       'machine_sync', 'observed', 'temperature', latest.series_name, 'temperature',
       to_jsonb(latest.value), jsonb_build_object('series_name', latest.series_name, 'reading_time', latest.reading_time, 'replayed', true)
FROM (
  SELECT DISTINCT ON (temperature.machine_id, public.normalize_temperature_series(temperature.series_name))
    temperature.machine_id, temperature.series_name, temperature.value, temperature.reading_time
  FROM public.huaxin_temperatures temperature
  WHERE public.normalize_temperature_series(temperature.series_name) = 'pre-cooling'
  ORDER BY temperature.machine_id, public.normalize_temperature_series(temperature.series_name), temperature.reading_time DESC, temperature.id DESC
) latest
JOIN public.machines machine ON machine.id = latest.machine_id AND machine.deployed;

GRANT SELECT ON public.v_machines, public.v_alerts TO authenticated;
