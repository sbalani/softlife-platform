ALTER TABLE public.machine_defrost_schedules
  ADD COLUMN requires_intervention BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE public.machine_command_leases (
  machine_id UUID PRIMARY KEY REFERENCES public.machines(id) ON DELETE CASCADE,
  owner_token UUID NOT NULL,
  purpose TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.machine_command_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_command_leases FROM anon, authenticated;

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
  v_schedule_id UUID;
  v_existing_alert UUID;
BEGIN
  IF p_state NOT IN ('recovery', 'failed', 'manual_intervention') THEN RAISE EXCEPTION 'Invalid failure state'; END IF;
  UPDATE public.machine_defrost_runs
  SET state = p_state,
      next_action_at = CASE WHEN p_state = 'recovery' THEN now() + INTERVAL '1 minute' ELSE next_action_at END,
      recovery_attempts = recovery_attempts + CASE WHEN p_state = 'recovery' THEN 1 ELSE 0 END,
      failure_detail = p_detail,
      completed_at = CASE WHEN p_state = 'recovery' THEN NULL ELSE now() END,
      lease_owner = NULL, lease_until = NULL, updated_at = now()
  WHERE id = p_run_id AND lease_owner = p_owner
  RETURNING machine_id, schedule_id INTO v_machine_id, v_schedule_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Defrost run lease was lost'; END IF;
  UPDATE public.machine_defrost_schedules SET requires_intervention = true, updated_at = now() WHERE id = v_schedule_id;
  SELECT tenant_id INTO v_tenant_id FROM public.machines WHERE id = v_machine_id;
  SELECT id INTO v_existing_alert FROM public.alerts
  WHERE type = 'defrost_automation_failed' AND machine_id = v_machine_id AND resolved_at IS NULL FOR UPDATE;
  IF v_existing_alert IS NULL THEN
    INSERT INTO public.alerts (tenant_id, type, severity, machine_id, entity_key, title, message, mobile_notification)
    VALUES (v_tenant_id, 'defrost_automation_failed', 'critical', v_machine_id, p_run_id::TEXT,
      'Automated defrost needs intervention', p_detail || ' Sales remain disabled. Inspect the machine before resuming sales.', true);
  ELSE
    UPDATE public.alerts
    SET message = p_detail || ' Sales remain disabled. Inspect the machine before resuming sales.',
        entity_key = p_run_id::TEXT,
        mobile_notification = true,
        push_notified_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id::TEXT THEN NULL ELSE push_notified_at END,
        push_claimed_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id::TEXT THEN NULL ELSE push_claimed_at END
    WHERE id = v_existing_alert;
  END IF;
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
    WHERE machine_id = NEW.id AND resolved_at IS NULL AND type <> 'defrost_automation_failed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_interactive_machine_command(p_machine_id UUID, p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::TEXT, 0));
  IF EXISTS (SELECT 1 FROM public.machine_defrost_runs WHERE machine_id = p_machine_id AND state IN ('scheduled','thawing','thaw_closed','forming','recovery'))
    OR EXISTS (SELECT 1 FROM public.machine_defrost_schedules WHERE machine_id = p_machine_id AND requires_intervention)
  THEN RETURN false;
  END IF;
  INSERT INTO public.machine_command_leases (machine_id, owner_token, purpose, lease_until)
  VALUES (p_machine_id, p_owner, 'interactive', now() + INTERVAL '1 minute')
  ON CONFLICT (machine_id) DO UPDATE SET owner_token = EXCLUDED.owner_token, purpose = EXCLUDED.purpose, lease_until = EXCLUDED.lease_until
  WHERE machine_command_leases.lease_until < now();
  RETURN EXISTS (SELECT 1 FROM public.machine_command_leases WHERE machine_id = p_machine_id AND owner_token = p_owner);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_interactive_machine_command(p_machine_id UUID, p_owner UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ DELETE FROM public.machine_command_leases WHERE machine_id = p_machine_id AND owner_token = p_owner $$;

CREATE OR REPLACE FUNCTION public.clear_defrost_intervention(p_machine_id UUID, p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  UPDATE public.machine_defrost_schedules SET requires_intervention = false, updated_by = p_admin_id, updated_at = now() WHERE machine_id = p_machine_id;
  UPDATE public.alerts SET resolved_at = now(), resolved_by = p_admin_id
  WHERE machine_id = p_machine_id AND type = 'defrost_automation_failed' AND resolved_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_defrost_runs(p_owner UUID, p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.machine_defrost_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate RECORD;
BEGIN
  FOR candidate IN
    SELECT schedule.id AS schedule_id, schedule.machine_id,
           (now() AT TIME ZONE schedule.time_zone)::DATE AS local_date,
           (((now() AT TIME ZONE schedule.time_zone)::DATE + schedule.local_start_time) AT TIME ZONE schedule.time_zone) AS scheduled_for
    FROM public.machine_defrost_schedules schedule
    JOIN public.machines machine ON machine.id = schedule.machine_id
    WHERE schedule.enabled AND NOT schedule.requires_intervention AND machine.deployed
  LOOP
    IF candidate.scheduled_for <= now() AND candidate.scheduled_for > now() - INTERVAL '10 minutes'
      AND pg_try_advisory_xact_lock(hashtextextended(candidate.machine_id::TEXT, 0))
      AND NOT EXISTS (SELECT 1 FROM public.machine_command_leases lease WHERE lease.machine_id = candidate.machine_id AND lease.lease_until >= now())
    THEN
      INSERT INTO public.machine_defrost_runs (schedule_id, machine_id, scheduled_local_date, scheduled_for, next_action_at)
      VALUES (candidate.schedule_id, candidate.machine_id, candidate.local_date, candidate.scheduled_for, now())
      ON CONFLICT (schedule_id, scheduled_local_date) DO NOTHING;
    END IF;
  END LOOP;

  RETURN QUERY
  WITH due AS (
    SELECT run.id FROM public.machine_defrost_runs run
    WHERE run.state IN ('scheduled', 'thawing', 'thaw_closed', 'forming', 'recovery')
      AND run.next_action_at <= now() AND (run.lease_until IS NULL OR run.lease_until < now())
    ORDER BY run.next_action_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit, 1), 25)
  )
  UPDATE public.machine_defrost_runs run
  SET lease_owner = p_owner, lease_until = now() + INTERVAL '3 minutes', updated_at = now()
  FROM due WHERE run.id = due.id RETURNING run.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_machine_operations(
  p_machine_id UUID, p_deployed BOOLEAN, p_defrost_enabled BOOLEAN,
  p_defrost_time TIME, p_defrost_seconds INTEGER, p_updated_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_blocked BOOLEAN;
BEGIN
  SELECT requires_intervention INTO v_blocked FROM public.machine_defrost_schedules WHERE machine_id = p_machine_id;
  IF p_defrost_enabled AND (NOT p_deployed OR COALESCE(v_blocked, false)) THEN RAISE EXCEPTION 'Clear the deployment or defrost intervention before enabling the schedule'; END IF;
  UPDATE public.machines SET deployed = p_deployed WHERE id = p_machine_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  INSERT INTO public.machine_defrost_schedules (machine_id, enabled, local_start_time, time_zone, defrost_seconds, formation_timeout_seconds, updated_by, updated_at)
  VALUES (p_machine_id, p_defrost_enabled, p_defrost_time, 'Europe/Madrid', p_defrost_seconds, 5400, p_updated_by, now())
  ON CONFLICT (machine_id) DO UPDATE SET enabled = EXCLUDED.enabled, local_start_time = EXCLUDED.local_start_time,
    defrost_seconds = EXCLUDED.defrost_seconds, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.claim_interactive_machine_command(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_interactive_machine_command(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_defrost_intervention(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_interactive_machine_command(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_interactive_machine_command(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_defrost_intervention(UUID, UUID) TO service_role;
