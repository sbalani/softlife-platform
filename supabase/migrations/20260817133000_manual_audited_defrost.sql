ALTER TABLE public.machine_defrost_runs
  DROP CONSTRAINT machine_defrost_runs_state_check,
  DROP CONSTRAINT machine_defrost_runs_schedule_id_scheduled_local_date_key,
  ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT 'scheduled' CHECK (trigger_kind IN ('scheduled', 'manual')),
  ADD COLUMN requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN request_id UUID UNIQUE,
  ADD COLUMN defrost_seconds_snapshot INTEGER,
  ADD COLUMN formation_timeout_seconds_snapshot INTEGER,
  ADD COLUMN refrigeration_started_at TIMESTAMPTZ,
  ADD COLUMN refrigeration_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN formation_poll_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN sales_started_at TIMESTAMPTZ,
  ADD COLUMN sales_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN sales_blocked_observed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN final_refrigeration_value TEXT,
  ADD COLUMN final_sales_value TEXT,
  ADD COLUMN outcome TEXT;

ALTER TABLE public.machine_defrost_runs
  ADD CONSTRAINT machine_defrost_runs_state_check CHECK (state IN (
    'scheduled', 'thawing', 'thaw_closed', 'refrigeration_check', 'forming',
    'sales_check', 'recovery', 'completed', 'failed', 'manual_intervention'
  )),
  ADD CONSTRAINT machine_defrost_runs_outcome_check CHECK (outcome IS NULL OR outcome IN ('completed', 'failed', 'manual_intervention'));

UPDATE public.machine_defrost_runs run
SET defrost_seconds_snapshot = schedule.defrost_seconds,
    formation_timeout_seconds_snapshot = schedule.formation_timeout_seconds,
    trigger_kind = 'scheduled'
FROM public.machine_defrost_schedules schedule
WHERE schedule.id = run.schedule_id;

ALTER TABLE public.machine_defrost_runs
  ALTER COLUMN defrost_seconds_snapshot SET NOT NULL,
  ALTER COLUMN formation_timeout_seconds_snapshot SET NOT NULL;

CREATE UNIQUE INDEX machine_defrost_scheduled_day_idx
  ON public.machine_defrost_runs (schedule_id, scheduled_local_date)
  WHERE trigger_kind = 'scheduled';

DROP INDEX public.machine_defrost_one_active_run_idx;
DROP INDEX public.machine_defrost_due_runs_idx;
CREATE UNIQUE INDEX machine_defrost_one_active_run_idx ON public.machine_defrost_runs (machine_id)
WHERE state IN ('scheduled', 'thawing', 'thaw_closed', 'refrigeration_check', 'forming', 'sales_check', 'recovery');
CREATE INDEX machine_defrost_due_runs_idx ON public.machine_defrost_runs (next_action_at)
WHERE state IN ('scheduled', 'thawing', 'thaw_closed', 'refrigeration_check', 'forming', 'sales_check', 'recovery');

ALTER TABLE public.machine_command_attempts
  ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  ADD COLUMN provider_serial TEXT,
  ADD COLUMN response_received_at TIMESTAMPTZ,
  ADD COLUMN effect_confirmed_at TIMESTAMPTZ;

CREATE TABLE public.machine_defrost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.machine_defrost_runs(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  state_before TEXT,
  state_after TEXT,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, event_key)
);
CREATE INDEX machine_defrost_events_run_idx ON public.machine_defrost_events (run_id, occurred_at, id);

CREATE TABLE public.machine_defrost_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.machine_defrost_runs(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  checkpoint TEXT NOT NULL,
  poll_number INTEGER NOT NULL DEFAULT 0,
  refrigeration_value TEXT,
  defrost_value TEXT,
  formation_pct NUMERIC,
  sales_value TEXT,
  operating_value TEXT,
  raw_status JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, checkpoint, poll_number)
);
CREATE INDEX machine_defrost_telemetry_run_idx ON public.machine_defrost_telemetry (run_id, observed_at, id);

ALTER TABLE public.machine_defrost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_defrost_telemetry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_defrost_events, public.machine_defrost_telemetry FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.append_defrost_event(
  p_run_id UUID,
  p_event_key TEXT,
  p_event_type TEXT,
  p_state_before TEXT DEFAULT NULL,
  p_state_after TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_detail JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_machine_id UUID;
BEGIN
  SELECT machine_id INTO v_machine_id FROM public.machine_defrost_runs WHERE id = p_run_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Defrost run not found'; END IF;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_before, state_after, actor_id, detail)
  VALUES (p_run_id, v_machine_id, p_event_key, p_event_type, p_state_before, p_state_after, p_actor_id, COALESCE(p_detail, '{}'::jsonb))
  ON CONFLICT (run_id, event_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_manual_defrost(
  p_machine_id UUID,
  p_admin_id UUID,
  p_request_id UUID
)
RETURNS public.machine_defrost_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.machine_defrost_schedules;
  v_machine public.machines;
  v_run public.machine_defrost_runs;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT * INTO v_run FROM public.machine_defrost_runs WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_run; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::TEXT, 0));
  SELECT * INTO v_machine FROM public.machines WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF NOT v_machine.deployed THEN RAISE EXCEPTION 'Machine must be deployed before defrost'; END IF;
  IF v_machine.device_imei IS NULL OR length(trim(v_machine.device_imei)) = 0 THEN RAISE EXCEPTION 'Machine has no IMEI'; END IF;
  SELECT * INTO v_schedule FROM public.machine_defrost_schedules WHERE machine_id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Save a defrost duration before running defrost'; END IF;
  IF v_schedule.requires_intervention THEN RAISE EXCEPTION 'Clear the defrost intervention before starting another cycle'; END IF;
  IF EXISTS (SELECT 1 FROM public.machine_command_leases WHERE machine_id = p_machine_id AND lease_until >= now()) THEN
    RAISE EXCEPTION 'Another machine command is in progress';
  END IF;
  IF EXISTS (SELECT 1 FROM public.machine_defrost_runs WHERE machine_id = p_machine_id AND state IN ('scheduled','thawing','thaw_closed','refrigeration_check','forming','sales_check','recovery')) THEN
    RAISE EXCEPTION 'A defrost cycle is already active';
  END IF;
  INSERT INTO public.machine_defrost_runs (
    schedule_id, machine_id, scheduled_local_date, scheduled_for, state, next_action_at,
    trigger_kind, requested_by, request_id, defrost_seconds_snapshot, formation_timeout_seconds_snapshot
  ) VALUES (
    v_schedule.id, p_machine_id, (now() AT TIME ZONE v_schedule.time_zone)::DATE, now(), 'scheduled', now(),
    'manual', p_admin_id, p_request_id, v_schedule.defrost_seconds, v_schedule.formation_timeout_seconds
  ) RETURNING * INTO v_run;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_after, actor_id, detail)
  VALUES (v_run.id, p_machine_id, 'cycle_requested', 'cycle_requested', 'scheduled', p_admin_id,
    jsonb_build_object('trigger_kind', 'manual', 'defrost_seconds', v_schedule.defrost_seconds, 'formation_timeout_seconds', v_schedule.formation_timeout_seconds));
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_defrost_runs(p_owner UUID, p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.machine_defrost_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE candidate RECORD;
BEGIN
  FOR candidate IN
    SELECT schedule.id AS schedule_id, schedule.machine_id, schedule.defrost_seconds, schedule.formation_timeout_seconds,
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
      WITH inserted AS (
        INSERT INTO public.machine_defrost_runs (
          schedule_id, machine_id, scheduled_local_date, scheduled_for, next_action_at,
          trigger_kind, defrost_seconds_snapshot, formation_timeout_seconds_snapshot
        ) VALUES (
          candidate.schedule_id, candidate.machine_id, candidate.local_date, candidate.scheduled_for, now(),
          'scheduled', candidate.defrost_seconds, candidate.formation_timeout_seconds
        ) ON CONFLICT DO NOTHING RETURNING id, machine_id
      )
      INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_after, detail)
      SELECT id, machine_id, 'cycle_scheduled', 'cycle_scheduled', 'scheduled',
        jsonb_build_object('defrost_seconds', candidate.defrost_seconds, 'formation_timeout_seconds', candidate.formation_timeout_seconds)
      FROM inserted;
    END IF;
  END LOOP;
  RETURN QUERY
  WITH due AS (
    SELECT run.id FROM public.machine_defrost_runs run
    WHERE run.state IN ('scheduled','thawing','thaw_closed','refrigeration_check','forming','sales_check','recovery')
      AND run.next_action_at <= now() AND (run.lease_until IS NULL OR run.lease_until < now())
    ORDER BY run.next_action_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit, 1), 25)
  )
  UPDATE public.machine_defrost_runs run
  SET lease_owner = p_owner, lease_until = now() + INTERVAL '3 minutes', updated_at = now()
  FROM due WHERE run.id = due.id RETURNING run.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_defrost_failure(
  p_run_id UUID, p_owner UUID, p_detail TEXT, p_state TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_machine_id UUID; v_tenant_id UUID; v_schedule_id UUID; v_existing_alert UUID; v_previous_state TEXT;
BEGIN
  IF p_state NOT IN ('recovery', 'failed', 'manual_intervention') THEN RAISE EXCEPTION 'Invalid failure state'; END IF;
  SELECT state INTO v_previous_state FROM public.machine_defrost_runs WHERE id = p_run_id AND lease_owner = p_owner;
  UPDATE public.machine_defrost_runs
  SET state = p_state, next_action_at = CASE WHEN p_state = 'recovery' THEN now() + INTERVAL '1 minute' ELSE next_action_at END,
      recovery_attempts = recovery_attempts + CASE WHEN p_state = 'recovery' THEN 1 ELSE 0 END,
      failure_detail = p_detail, outcome = CASE WHEN p_state = 'recovery' THEN NULL ELSE p_state END,
      completed_at = CASE WHEN p_state = 'recovery' THEN NULL ELSE now() END,
      lease_owner = NULL, lease_until = NULL, updated_at = now()
  WHERE id = p_run_id AND lease_owner = p_owner RETURNING machine_id, schedule_id INTO v_machine_id, v_schedule_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Defrost run lease was lost'; END IF;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_before, state_after, detail)
  VALUES (p_run_id, v_machine_id, 'failure_' || extract(epoch from clock_timestamp())::BIGINT, 'failure_detected', v_previous_state, p_state, jsonb_build_object('detail', p_detail));
  UPDATE public.machine_defrost_schedules SET requires_intervention = true, updated_at = now() WHERE id = v_schedule_id;
  SELECT tenant_id INTO v_tenant_id FROM public.machines WHERE id = v_machine_id;
  SELECT id INTO v_existing_alert FROM public.alerts WHERE type = 'defrost_automation_failed' AND machine_id = v_machine_id AND resolved_at IS NULL FOR UPDATE;
  IF v_existing_alert IS NULL THEN
    INSERT INTO public.alerts (tenant_id, type, severity, machine_id, entity_key, title, message, mobile_notification)
    VALUES (v_tenant_id, 'defrost_automation_failed', 'critical', v_machine_id, p_run_id::TEXT,
      'Defrost cycle needs intervention', p_detail || ' Sales remain disabled. Inspect the machine before resuming sales.', true);
  ELSE
    UPDATE public.alerts SET title = 'Defrost cycle needs intervention', message = p_detail || ' Sales remain disabled. Inspect the machine before resuming sales.',
      entity_key = p_run_id::TEXT, mobile_notification = true,
      push_notified_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id::TEXT THEN NULL ELSE push_notified_at END,
      push_claimed_at = CASE WHEN entity_key IS DISTINCT FROM p_run_id::TEXT THEN NULL ELSE push_claimed_at END
    WHERE id = v_existing_alert;
  END IF;
END;
$$;

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
  UPDATE public.alerts SET resolved_at = now(), resolved_by = p_admin_id WHERE machine_id = p_machine_id AND type = 'defrost_automation_failed' AND resolved_at IS NULL;
  IF v_run_id IS NOT NULL THEN
    INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, actor_id, detail)
    VALUES (v_run_id, p_machine_id, 'intervention_cleared_' || extract(epoch from clock_timestamp())::BIGINT, 'intervention_cleared', p_admin_id,
      jsonb_build_object('attestation', 'Admin confirmed defrost is off, refrigeration is on, and the machine was inspected'));
  END IF;
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
  IF EXISTS (SELECT 1 FROM public.machine_defrost_runs WHERE machine_id = p_machine_id AND state IN ('scheduled','thawing','thaw_closed','refrigeration_check','forming','sales_check','recovery'))
    OR EXISTS (SELECT 1 FROM public.machine_defrost_schedules WHERE machine_id = p_machine_id AND requires_intervention)
  THEN RETURN false;
  END IF;
  INSERT INTO public.machine_command_leases (machine_id, owner_token, purpose, lease_until)
  VALUES (p_machine_id, p_owner, 'interactive', now() + INTERVAL '3 minutes')
  ON CONFLICT (machine_id) DO UPDATE SET owner_token = EXCLUDED.owner_token, purpose = EXCLUDED.purpose, lease_until = EXCLUDED.lease_until
  WHERE machine_command_leases.lease_until < now();
  RETURN EXISTS (SELECT 1 FROM public.machine_command_leases WHERE machine_id = p_machine_id AND owner_token = p_owner);
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_defrost_cron(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, net
AS $$
DECLARE existing_job RECORD; generated_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/defrost$' THEN RAISE EXCEPTION 'Invalid defrost function URL'; END IF;
  generated_token := encode(extensions.gen_random_bytes(32), 'hex');
  DELETE FROM vault.secrets WHERE name = 'softlife_defrost_cron_token';
  PERFORM vault.create_secret(generated_token, 'softlife_defrost_cron_token', 'Authenticates the pg_cron defrost Edge Function request');
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'softlife-defrost-every-minute' LOOP PERFORM cron.unschedule(existing_job.jobid); END LOOP;
  PERFORM cron.schedule(
    'softlife-defrost-every-minute', '* * * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_defrost_cron_token')),
        body := '{}'::jsonb,
        timeout_milliseconds := 50000
      )
      WHERE EXISTS (
        SELECT 1 FROM public.machine_defrost_runs run
        WHERE run.state IN ('scheduled','thawing','thaw_closed','refrigeration_check','forming','sales_check','recovery')
          AND run.next_action_at <= now() AND (run.lease_until IS NULL OR run.lease_until < now())
        UNION ALL
        SELECT 1 FROM public.machine_defrost_schedules schedule
        JOIN public.machines machine ON machine.id = schedule.machine_id
        CROSS JOIN LATERAL (SELECT (((now() AT TIME ZONE schedule.time_zone)::DATE + schedule.local_start_time) AT TIME ZONE schedule.time_zone) AS scheduled_for) local_time
        WHERE schedule.enabled AND NOT schedule.requires_intervention AND machine.deployed
          AND local_time.scheduled_for <= now() AND local_time.scheduled_for > now() - INTERVAL '10 minutes'
      );
    $job$, p_function_url)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.append_defrost_event(UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_manual_defrost(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_defrost_event(UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_manual_defrost(UUID, UUID, UUID) TO service_role;
