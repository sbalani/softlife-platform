ALTER TABLE public.machine_defrost_runs
  ADD COLUMN formation_reset_observed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.alerts
  ADD COLUMN push_claimed_at TIMESTAMPTZ;

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
  SELECT schedule.id, schedule.machine_id, local_time.local_date,
         local_time.scheduled_for, now()
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
    WHERE run.state IN ('scheduled', 'thawing', 'thaw_closed', 'forming')
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

REVOKE ALL ON FUNCTION public.claim_due_defrost_runs(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_defrost_runs(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.set_machine_operations(
  p_machine_id UUID,
  p_deployed BOOLEAN,
  p_defrost_enabled BOOLEAN,
  p_defrost_time TIME,
  p_defrost_seconds INTEGER,
  p_updated_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_defrost_enabled AND NOT p_deployed THEN
    RAISE EXCEPTION 'Deploy the machine before enabling its defrost schedule';
  END IF;
  UPDATE public.machines SET deployed = p_deployed WHERE id = p_machine_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  INSERT INTO public.machine_defrost_schedules (
    machine_id, enabled, local_start_time, time_zone, defrost_seconds,
    formation_timeout_seconds, updated_by, updated_at
  ) VALUES (
    p_machine_id, p_defrost_enabled, p_defrost_time, 'Europe/Madrid', p_defrost_seconds,
    5400, p_updated_by, now()
  )
  ON CONFLICT (machine_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    local_start_time = EXCLUDED.local_start_time,
    defrost_seconds = EXCLUDED.defrost_seconds,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_machine_operations(UUID, BOOLEAN, BOOLEAN, TIME, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_machine_operations(UUID, BOOLEAN, BOOLEAN, TIME, INTEGER, UUID) TO service_role;
