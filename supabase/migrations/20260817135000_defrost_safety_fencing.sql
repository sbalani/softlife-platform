ALTER TABLE public.machine_defrost_telemetry
  DROP CONSTRAINT machine_defrost_telemetry_run_id_checkpoint_poll_number_key;

CREATE OR REPLACE FUNCTION public.transition_defrost_run(
  p_run_id UUID,
  p_owner UUID,
  p_expected_state TEXT,
  p_next_state TEXT,
  p_event_key TEXT,
  p_values JSONB DEFAULT '{}'::jsonb,
  p_release_lease BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_machine_id UUID;
BEGIN
  UPDATE public.machine_defrost_runs
  SET state = p_next_state,
      next_action_at = CASE WHEN p_values ? 'next_action_at' THEN (p_values->>'next_action_at')::TIMESTAMPTZ ELSE next_action_at END,
      started_at = CASE WHEN p_values ? 'started_at' THEN (p_values->>'started_at')::TIMESTAMPTZ ELSE started_at END,
      refrigeration_started_at = CASE WHEN p_values ? 'refrigeration_started_at' THEN (p_values->>'refrigeration_started_at')::TIMESTAMPTZ ELSE refrigeration_started_at END,
      refrigeration_attempts = CASE WHEN p_values ? 'refrigeration_attempts' THEN (p_values->>'refrigeration_attempts')::INTEGER ELSE refrigeration_attempts END,
      formation_started_at = CASE WHEN p_values ? 'formation_started_at' THEN (p_values->>'formation_started_at')::TIMESTAMPTZ ELSE formation_started_at END,
      formation_reset_observed = CASE WHEN p_values ? 'formation_reset_observed' THEN (p_values->>'formation_reset_observed')::BOOLEAN ELSE formation_reset_observed END,
      formation_poll_count = CASE WHEN p_values ? 'formation_poll_count' THEN (p_values->>'formation_poll_count')::INTEGER ELSE formation_poll_count END,
      last_formation_pct = CASE WHEN p_values ? 'last_formation_pct' THEN (p_values->>'last_formation_pct')::NUMERIC ELSE last_formation_pct END,
      last_status_observed_at = CASE WHEN p_values ? 'last_status_observed_at' THEN (p_values->>'last_status_observed_at')::TIMESTAMPTZ ELSE last_status_observed_at END,
      final_refrigeration_value = CASE WHEN p_values ? 'final_refrigeration_value' THEN p_values->>'final_refrigeration_value' ELSE final_refrigeration_value END,
      sales_started_at = CASE WHEN p_values ? 'sales_started_at' THEN (p_values->>'sales_started_at')::TIMESTAMPTZ ELSE sales_started_at END,
      sales_attempts = CASE WHEN p_values ? 'sales_attempts' THEN (p_values->>'sales_attempts')::INTEGER ELSE sales_attempts END,
      sales_blocked_observed = CASE WHEN p_values ? 'sales_blocked_observed' THEN (p_values->>'sales_blocked_observed')::BOOLEAN ELSE sales_blocked_observed END,
      final_sales_value = CASE WHEN p_values ? 'final_sales_value' THEN p_values->>'final_sales_value' ELSE final_sales_value END,
      completed_at = CASE WHEN p_values ? 'completed_at' THEN (p_values->>'completed_at')::TIMESTAMPTZ ELSE completed_at END,
      outcome = CASE WHEN p_values ? 'outcome' THEN p_values->>'outcome' ELSE outcome END,
      failure_detail = CASE WHEN p_values ? 'failure_detail' THEN p_values->>'failure_detail' ELSE failure_detail END,
      lease_owner = CASE WHEN p_release_lease THEN NULL ELSE lease_owner END,
      lease_until = CASE WHEN p_release_lease THEN NULL ELSE now() + INTERVAL '10 minutes' END,
      updated_at = now()
  WHERE id = p_run_id AND lease_owner = p_owner AND state = p_expected_state
  RETURNING machine_id INTO v_machine_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Defrost run lease or expected state was lost'; END IF;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_before, state_after, detail)
  VALUES (p_run_id, v_machine_id, p_event_key, 'state_transition', p_expected_state, p_next_state, COALESCE(p_values, '{}'::jsonb))
  ON CONFLICT (run_id, event_key) DO NOTHING;
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
        INSERT INTO public.machine_defrost_runs (schedule_id, machine_id, scheduled_local_date, scheduled_for, next_action_at, trigger_kind, defrost_seconds_snapshot, formation_timeout_seconds_snapshot)
        VALUES (candidate.schedule_id, candidate.machine_id, candidate.local_date, candidate.scheduled_for, now(), 'scheduled', candidate.defrost_seconds, candidate.formation_timeout_seconds)
        ON CONFLICT DO NOTHING RETURNING id, machine_id
      )
      INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_after, detail)
      SELECT id, machine_id, 'cycle_scheduled', 'cycle_scheduled', 'scheduled', jsonb_build_object('defrost_seconds', candidate.defrost_seconds, 'formation_timeout_seconds', candidate.formation_timeout_seconds)
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
  SET lease_owner = p_owner, lease_until = now() + INTERVAL '10 minutes', updated_at = now()
  FROM due WHERE run.id = due.id RETURNING run.*;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_defrost_run(UUID, UUID, TEXT, TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_defrost_run(UUID, UUID, TEXT, TEXT, TEXT, JSONB, BOOLEAN) TO service_role;
