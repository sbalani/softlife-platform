ALTER TABLE public.machine_defrost_runs DROP CONSTRAINT machine_defrost_runs_state_check;
ALTER TABLE public.machine_defrost_runs
  ADD CONSTRAINT machine_defrost_runs_state_check CHECK (state IN ('scheduled', 'thawing', 'thaw_closed', 'forming', 'recovery', 'completed', 'failed', 'manual_intervention')),
  ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0;

DROP INDEX public.machine_defrost_one_active_run_idx;
DROP INDEX public.machine_defrost_due_runs_idx;
CREATE UNIQUE INDEX machine_defrost_one_active_run_idx ON public.machine_defrost_runs (machine_id)
WHERE state IN ('scheduled', 'thawing', 'thaw_closed', 'forming', 'recovery');
CREATE INDEX machine_defrost_due_runs_idx ON public.machine_defrost_runs (next_action_at)
WHERE state IN ('scheduled', 'thawing', 'thaw_closed', 'forming', 'recovery');

CREATE OR REPLACE FUNCTION public.record_defrost_failure(
  p_run_id UUID,
  p_owner UUID,
  p_detail TEXT,
  p_state TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id UUID;
  v_tenant_id UUID;
  v_existing_alert UUID;
BEGIN
  IF p_state NOT IN ('recovery', 'failed', 'manual_intervention') THEN
    RAISE EXCEPTION 'Invalid failure state';
  END IF;
  UPDATE public.machine_defrost_runs
  SET state = p_state,
      next_action_at = CASE WHEN p_state = 'recovery' THEN now() + INTERVAL '1 minute' ELSE next_action_at END,
      recovery_attempts = recovery_attempts + CASE WHEN p_state = 'recovery' THEN 1 ELSE 0 END,
      failure_detail = p_detail,
      completed_at = CASE WHEN p_state = 'recovery' THEN NULL ELSE now() END,
      lease_owner = NULL,
      lease_until = NULL,
      updated_at = now()
  WHERE id = p_run_id AND lease_owner = p_owner
  RETURNING machine_id INTO v_machine_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Defrost run lease was lost'; END IF;
  SELECT tenant_id INTO v_tenant_id FROM public.machines WHERE id = v_machine_id;
  SELECT id INTO v_existing_alert FROM public.alerts
  WHERE type = 'defrost_automation_failed' AND machine_id = v_machine_id AND resolved_at IS NULL
  FOR UPDATE;
  IF v_existing_alert IS NULL THEN
    INSERT INTO public.alerts (
      tenant_id, type, severity, machine_id, entity_key, title, message, mobile_notification
    ) VALUES (
      v_tenant_id, 'defrost_automation_failed', 'critical', v_machine_id, p_run_id,
      'Automated defrost needs intervention', p_detail || ' Sales remain disabled. Inspect the machine before resuming sales.', true
    );
  ELSE
    UPDATE public.alerts
    SET message = p_detail || ' Sales remain disabled. Inspect the machine before resuming sales.',
        entity_key = p_run_id,
        mobile_notification = true,
        push_notified_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id THEN NULL ELSE push_notified_at END,
        push_claimed_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id THEN NULL ELSE push_claimed_at END
    WHERE id = v_existing_alert;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_defrost_failure(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_defrost_failure(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_due_defrost_runs(p_owner UUID, p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.machine_defrost_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.machine_defrost_runs (
    schedule_id, machine_id, scheduled_local_date, scheduled_for, next_action_at
  )
  SELECT schedule.id, schedule.machine_id, local_time.local_date, local_time.scheduled_for, now()
  FROM public.machine_defrost_schedules schedule
  JOIN public.machines machine ON machine.id = schedule.machine_id
  CROSS JOIN LATERAL (
    SELECT (now() AT TIME ZONE schedule.time_zone)::DATE AS local_date,
           (((now() AT TIME ZONE schedule.time_zone)::DATE + schedule.local_start_time) AT TIME ZONE schedule.time_zone) AS scheduled_for
  ) local_time
  WHERE schedule.enabled AND machine.deployed
    AND local_time.scheduled_for <= now()
    AND local_time.scheduled_for > now() - INTERVAL '10 minutes'
  ON CONFLICT (schedule_id, scheduled_local_date) DO NOTHING;

  RETURN QUERY
  WITH due AS (
    SELECT run.id
    FROM public.machine_defrost_runs run
    WHERE run.state IN ('scheduled', 'thawing', 'thaw_closed', 'forming', 'recovery')
      AND run.next_action_at <= now()
      AND (run.lease_until IS NULL OR run.lease_until < now())
    ORDER BY run.next_action_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 25)
  )
  UPDATE public.machine_defrost_runs run
  SET lease_owner = p_owner, lease_until = now() + INTERVAL '3 minutes', updated_at = now()
  FROM due
  WHERE run.id = due.id
  RETURNING run.*;
END;
$$;

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
    SET push_claimed_at = now()
    WHERE alert.id IN (
      SELECT pending.id FROM public.alerts pending
      LEFT JOIN public.machines machine ON machine.id = pending.machine_id
      WHERE pending.resolved_at IS NULL
        AND pending.push_notified_at IS NULL
        AND (pending.push_claimed_at IS NULL OR pending.push_claimed_at < now() - INTERVAL '10 minutes')
        AND pending.mobile_notification
        AND (pending.machine_id IS NULL OR machine.deployed OR pending.type = 'defrost_automation_failed')
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

REVOKE ALL ON FUNCTION public.claim_due_defrost_runs(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_defrost_runs(UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.claim_pending_alert_pushes(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_alert_pushes(INTEGER) TO service_role;
