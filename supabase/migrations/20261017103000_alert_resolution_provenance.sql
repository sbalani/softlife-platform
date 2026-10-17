ALTER TABLE public.alerts
  ADD COLUMN resolution_source TEXT
  CHECK (resolution_source IS NULL OR resolution_source IN ('telemetry', 'manual_dismissal', 'safety_clearance'));

UPDATE public.alerts
SET resolution_source = CASE
  WHEN resolved_by IS NULL THEN 'telemetry'
  WHEN type = 'defrost_automation_failed' AND EXISTS (
    SELECT 1
    FROM public.machine_defrost_events event
    WHERE event.run_id::TEXT = alerts.entity_key
      AND event.event_type = 'intervention_cleared'
      AND event.occurred_at <= alerts.resolved_at + INTERVAL '5 minutes'
  ) THEN 'safety_clearance'
  ELSE 'manual_dismissal'
END
WHERE resolved_at IS NOT NULL;

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_resolution_source_consistent CHECK (
    (resolved_at IS NULL AND resolution_source IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_source IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.set_alert_resolution_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.resolved_at IS NULL THEN
    NEW.resolution_source := NULL;
  ELSIF OLD.resolved_at IS NULL AND NEW.resolution_source IS NULL THEN
    NEW.resolution_source := CASE WHEN NEW.resolved_by IS NULL THEN 'telemetry' ELSE 'manual_dismissal' END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER alerts_set_resolution_source
BEFORE UPDATE OF resolved_at ON public.alerts
FOR EACH ROW EXECUTE FUNCTION public.set_alert_resolution_source();

CREATE OR REPLACE FUNCTION public.clear_defrost_intervention(p_machine_id UUID, p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_run_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF EXISTS (SELECT 1 FROM public.machine_defrost_runs WHERE machine_id = p_machine_id AND state IN ('scheduled','thawing','thaw_closed','refrigeration_check','forming','sales_check','recovery')) THEN
    RAISE EXCEPTION 'Cannot clear intervention while a defrost cycle is active';
  END IF;
  SELECT id INTO v_run_id FROM public.machine_defrost_runs WHERE machine_id = p_machine_id ORDER BY created_at DESC LIMIT 1;
  UPDATE public.machine_defrost_schedules SET requires_intervention = false, updated_by = p_admin_id, updated_at = now() WHERE machine_id = p_machine_id;
  UPDATE public.alerts SET resolved_at = now(), resolved_by = p_admin_id, resolution_source = 'safety_clearance'
  WHERE machine_id = p_machine_id AND type = 'defrost_automation_failed' AND resolved_at IS NULL;
  IF v_run_id IS NOT NULL THEN
    INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, actor_id, detail)
    VALUES (v_run_id, p_machine_id, 'intervention_cleared_' || extract(epoch from clock_timestamp())::BIGINT, 'intervention_cleared', p_admin_id,
      jsonb_build_object('attestation', 'Admin confirmed defrost is off, refrigeration is on, and the machine was inspected'));
  END IF;
END;
$$;
