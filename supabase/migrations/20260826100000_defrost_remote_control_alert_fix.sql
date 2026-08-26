-- Huaxin operating state 4 means sales were disabled by remote control. The
-- automated defrost process intentionally enters this state, so historical
-- state-4 ordering faults are false positives rather than machine failures.
UPDATE public.alerts alert
SET resolved_at = COALESCE(alert.resolved_at, now())
FROM public.machine_change_log change
WHERE alert.change_log_id = change.id
  AND alert.type = 'ordering_system_fault'
  AND alert.resolved_at IS NULL
  AND COALESCE(change.metadata->>'raw_value', '') ~ '^\s*\[4\]';

INSERT INTO public.incident_events (incident_id, event_type, from_status, to_status, message)
SELECT incident.id, 'resolved', incident.status, 'resolved',
  'Automatically resolved: Huaxin state 4 is the expected remote-control state during defrost or service.'
FROM public.incidents incident
JOIN public.alerts alert ON alert.id = incident.source_alert_id
JOIN public.machine_change_log change ON change.id = alert.change_log_id
WHERE incident.status IN ('open', 'in_progress')
  AND alert.type = 'ordering_system_fault'
  AND alert.resolved_at IS NOT NULL
  AND COALESCE(change.metadata->>'raw_value', '') ~ '^\s*\[4\]';

UPDATE public.incidents incident
SET status = 'resolved',
    resolution_summary = 'Automatically resolved: Huaxin state 4 is the expected remote-control state during defrost or service.',
    resolved_at = now(),
    resolved_by = NULL,
    closed_at = now(),
    closed_by = NULL,
    closure_kind = 'incident_report',
    closing_action_report_id = NULL,
    updated_at = now()
FROM public.alerts alert, public.machine_change_log change
WHERE alert.id = incident.source_alert_id
  AND change.id = alert.change_log_id
  AND incident.status IN ('open', 'in_progress')
  AND alert.type = 'ordering_system_fault'
  AND alert.resolved_at IS NOT NULL
  AND COALESCE(change.metadata->>'raw_value', '') ~ '^\s*\[4\]';

-- Reopen any genuinely active alert incident that was previously closed by an
-- Action Report before telemetry confirmed recovery.
INSERT INTO public.incident_events (incident_id, event_type, from_status, to_status, message)
SELECT id, 'reopened', status, 'open', 'Reopened because the source alert is still active.'
FROM public.incidents
WHERE source_kind = 'alert' AND source_alert_resolved_at IS NULL AND status IN ('resolved', 'closed');

UPDATE public.incidents
SET status = 'open', resolution_summary = NULL, resolved_at = NULL, resolved_by = NULL,
    closed_at = NULL, closed_by = NULL, closure_kind = NULL, closing_action_report_id = NULL, updated_at = now()
WHERE source_kind = 'alert' AND source_alert_resolved_at IS NULL AND status IN ('resolved', 'closed');

CREATE OR REPLACE FUNCTION public.prevent_active_alert_incident_resolution()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('resolved', 'closed')
    AND OLD.status IN ('open', 'in_progress')
    AND NEW.source_kind = 'alert'
    AND NEW.source_alert_resolved_at IS NULL THEN
    RAISE EXCEPTION 'Telemetry still reports this alert as active';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER incidents_prevent_active_alert_resolution
BEFORE UPDATE OF status ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.prevent_active_alert_incident_resolution();

REVOKE ALL ON FUNCTION public.prevent_active_alert_incident_resolution() FROM PUBLIC, anon, authenticated;
