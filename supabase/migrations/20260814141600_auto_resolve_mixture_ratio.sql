CREATE OR REPLACE FUNCTION public.resolve_mixture_ratio_from_operating_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  state_code TEXT;
BEGIN
  IF NEW.field <> 'raw:status_0_os' THEN RETURN NEW; END IF;
  state_code := (regexp_match(COALESCE(NEW.raw->>'value', ''), '^\[(\d+)]'))[1];
  IF state_code IS DISTINCT FROM '255' THEN
    UPDATE public.machine_status_snapshots
    SET value = 'false'::JSONB, raw = NEW.raw, observed_at = NEW.observed_at
    WHERE machine_id = NEW.machine_id AND field = 'mixture_ratio_fault' AND value #>> '{}' = 'true';
    UPDATE public.alerts alert
    SET resolved_at = now()
    FROM public.change_alert_rules rule
    WHERE alert.change_alert_rule_id = rule.id
      AND alert.machine_id = NEW.machine_id
      AND alert.resolved_at IS NULL
      AND rule.field = 'mixture_ratio_fault';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER machine_operating_status_resolves_mixture_ratio
AFTER INSERT OR UPDATE OF value, raw, observed_at ON public.machine_status_snapshots
FOR EACH ROW WHEN (NEW.field = 'raw:status_0_os')
EXECUTE FUNCTION public.resolve_mixture_ratio_from_operating_status();

UPDATE public.machine_status_snapshots operating
SET observed_at = operating.observed_at
WHERE operating.field = 'raw:status_0_os'
  AND (regexp_match(COALESCE(operating.raw->>'value', ''), '^\[(\d+)]'))[1] IS DISTINCT FROM '255';
