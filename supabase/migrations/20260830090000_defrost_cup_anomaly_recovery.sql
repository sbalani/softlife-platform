CREATE OR REPLACE FUNCTION public.record_defrost_failure(
  p_run_id UUID, p_owner UUID, p_detail TEXT, p_state TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_machine_id UUID; v_tenant_id UUID; v_schedule_id UUID; v_existing_alert UUID; v_previous_state TEXT; v_cup_wait BOOLEAN;
BEGIN
  IF p_state NOT IN ('recovery', 'failed', 'manual_intervention') THEN RAISE EXCEPTION 'Invalid failure state'; END IF;
  v_cup_wait := p_detail LIKE 'cup_anomaly_wait:%';
  SELECT state INTO v_previous_state FROM public.machine_defrost_runs WHERE id = p_run_id AND lease_owner = p_owner;
  UPDATE public.machine_defrost_runs
  SET state = p_state,
      next_action_at = CASE WHEN p_state = 'recovery' THEN now() + CASE WHEN v_cup_wait THEN INTERVAL '5 minutes' ELSE INTERVAL '1 minute' END ELSE next_action_at END,
      recovery_attempts = recovery_attempts + CASE WHEN p_state = 'recovery' THEN 1 ELSE 0 END,
      failure_detail = p_detail, outcome = CASE WHEN p_state = 'recovery' THEN NULL ELSE p_state END,
      completed_at = CASE WHEN p_state = 'recovery' THEN NULL ELSE now() END,
      lease_owner = NULL, lease_until = NULL, updated_at = now()
  WHERE id = p_run_id AND lease_owner = p_owner RETURNING machine_id, schedule_id INTO v_machine_id, v_schedule_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Defrost run lease was lost'; END IF;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_before, state_after, detail)
  VALUES (p_run_id, v_machine_id, 'failure_' || extract(epoch from clock_timestamp())::BIGINT, CASE WHEN v_cup_wait THEN 'cup_anomaly_wait' ELSE 'failure_detected' END, v_previous_state, p_state, jsonb_build_object('detail', p_detail));
  UPDATE public.machine_defrost_schedules SET requires_intervention = true, updated_at = now() WHERE id = v_schedule_id;
  SELECT tenant_id INTO v_tenant_id FROM public.machines WHERE id = v_machine_id;
  SELECT id INTO v_existing_alert FROM public.alerts WHERE type = 'defrost_automation_failed' AND machine_id = v_machine_id AND resolved_at IS NULL FOR UPDATE;
  IF v_existing_alert IS NULL THEN
    INSERT INTO public.alerts (tenant_id, type, severity, machine_id, entity_key, title, message, mobile_notification)
    VALUES (v_tenant_id, 'defrost_automation_failed', 'critical', v_machine_id, p_run_id::TEXT,
      CASE WHEN v_cup_wait THEN 'Defrost recovery waiting for cup issue' ELSE 'Defrost cycle needs intervention' END,
      p_detail || CASE WHEN v_cup_wait THEN ' Sales remain disabled until the cup issue clears; recovery will continue automatically.' ELSE ' Sales remain disabled. Inspect the machine before resuming sales.' END, true);
  ELSE
    UPDATE public.alerts SET title = CASE WHEN v_cup_wait THEN 'Defrost recovery waiting for cup issue' ELSE 'Defrost cycle needs intervention' END,
      message = p_detail || CASE WHEN v_cup_wait THEN ' Sales remain disabled until the cup issue clears; recovery will continue automatically.' ELSE ' Sales remain disabled. Inspect the machine before resuming sales.' END,
      entity_key = p_run_id::TEXT, mobile_notification = true,
      push_notified_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id::TEXT THEN NULL ELSE push_notified_at END,
      push_claimed_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id::TEXT THEN NULL ELSE push_claimed_at END
    WHERE id = v_existing_alert;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_defrost_cup_recovery(
  p_run_id UUID, p_owner UUID, p_observed_at TIMESTAMPTZ, p_final_sales_value TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_machine_id UUID; v_schedule_id UUID;
BEGIN
  UPDATE public.machine_defrost_runs
  SET state = 'completed', completed_at = p_observed_at, last_status_observed_at = p_observed_at,
      final_sales_value = p_final_sales_value, outcome = 'completed', failure_detail = NULL,
      lease_owner = NULL, lease_until = NULL, updated_at = now()
  WHERE id = p_run_id AND lease_owner = p_owner AND lease_until >= now() AND state = 'recovery' AND failure_detail LIKE 'cup_anomaly_wait:%'
  RETURNING machine_id, schedule_id INTO v_machine_id, v_schedule_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Cup anomaly recovery run lease was lost'; END IF;
  UPDATE public.machine_defrost_schedules SET requires_intervention = false, updated_at = now() WHERE id = v_schedule_id;
  UPDATE public.alerts SET resolved_at = p_observed_at WHERE machine_id = v_machine_id AND type = 'defrost_automation_failed' AND resolved_at IS NULL;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_before, state_after, detail)
  VALUES (p_run_id, v_machine_id, 'cup_anomaly_recovered_' || extract(epoch from clock_timestamp())::BIGINT,
    'cup_anomaly_recovered', 'recovery', 'completed', jsonb_build_object('observed_at', p_observed_at, 'sales', p_final_sales_value));
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_defrost_cup_recovery_lease(p_run_id UUID, p_owner UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_run_id UUID;
BEGIN
  UPDATE public.machine_defrost_runs
  SET lease_until = now() + INTERVAL '10 minutes', updated_at = now()
  WHERE id = p_run_id AND lease_owner = p_owner AND lease_until >= now()
    AND state = 'recovery' AND failure_detail LIKE 'cup_anomaly_wait:%'
  RETURNING id INTO v_run_id;
  IF v_run_id IS NULL THEN RAISE EXCEPTION 'Cup anomaly recovery lease is no longer valid'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_defrost_cup_recovery(UUID, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_defrost_cup_recovery(UUID, UUID, TIMESTAMPTZ, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.assert_defrost_cup_recovery_lease(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_defrost_cup_recovery_lease(UUID, UUID) TO service_role;

WITH recoverable AS (
  SELECT run.id
  FROM public.machine_defrost_runs run
  JOIN public.machine_defrost_schedules schedule ON schedule.id = run.schedule_id AND schedule.requires_intervention
  WHERE run.state = 'manual_intervention'
    AND run.id = (SELECT latest.id FROM public.machine_defrost_runs latest WHERE latest.machine_id = run.machine_id ORDER BY latest.created_at DESC LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.machine_defrost_events event
      WHERE event.run_id = run.id AND event.event_type = 'failure_detected'
        AND event.state_before = 'sales_check' AND event.state_after = 'recovery'
        AND event.detail->>'detail' ~ 'Sales resumption could not be confirmed.*operating state: \[(101|104|120)\]'
        AND EXISTS (
          SELECT 1 FROM public.machine_defrost_telemetry telemetry
          WHERE telemetry.run_id = run.id AND telemetry.operating_value ~ '^\[(101|104|120)\]'
            AND telemetry.observed_at BETWEEN event.created_at - INTERVAL '15 minutes' AND event.created_at
        )
        AND EXISTS (
          SELECT 1 FROM public.alerts alert
          WHERE alert.machine_id = run.machine_id AND alert.type IN ('cup_empty', 'cup_foreign_object', 'cup_blocked', 'cup_take_fault')
            AND alert.resolved_at IS NULL AND alert.created_at <= event.created_at
        )
    )
)
UPDATE public.machine_defrost_runs run
SET state = 'recovery', completed_at = NULL, outcome = NULL, next_action_at = now(),
    failure_detail = 'cup_anomaly_wait: Existing defrost intervention was caused by an active cup anomaly; automatic recovery queued.',
    lease_owner = NULL, lease_until = NULL, updated_at = now()
FROM recoverable WHERE run.id = recoverable.id;
