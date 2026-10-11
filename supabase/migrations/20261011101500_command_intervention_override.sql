CREATE OR REPLACE FUNCTION public.claim_interactive_machine_command(
  p_machine_id UUID,
  p_owner UUID,
  p_allow_intervention BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::TEXT, 0));
  IF EXISTS (
    SELECT 1 FROM public.machine_defrost_runs
    WHERE machine_id = p_machine_id
      AND state IN ('scheduled','thawing','thaw_closed','refrigeration_check','forming','sales_check','recovery')
  ) OR (
    NOT p_allow_intervention AND EXISTS (
      SELECT 1 FROM public.machine_defrost_schedules
      WHERE machine_id = p_machine_id AND requires_intervention
    )
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO public.machine_command_leases (machine_id, owner_token, purpose, lease_until)
  VALUES (p_machine_id, p_owner, CASE WHEN p_allow_intervention THEN 'interactive_override' ELSE 'interactive' END, now() + INTERVAL '3 minutes')
  ON CONFLICT (machine_id) DO UPDATE
    SET owner_token = EXCLUDED.owner_token, purpose = EXCLUDED.purpose, lease_until = EXCLUDED.lease_until
    WHERE machine_command_leases.lease_until < now();
  RETURN EXISTS (SELECT 1 FROM public.machine_command_leases WHERE machine_id = p_machine_id AND owner_token = p_owner);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_interactive_machine_command(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_interactive_machine_command(UUID, UUID, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.take_over_defrost_recovery(
  p_machine_id UUID,
  p_admin_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.machine_defrost_runs;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 5 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'An override reason between 5 and 500 characters is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::TEXT, 0));
  SELECT * INTO v_run
  FROM public.machine_defrost_runs
  WHERE machine_id = p_machine_id AND state = 'recovery'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RETURN true; END IF;
  IF v_run.lease_until IS NOT NULL AND v_run.lease_until >= now() THEN RETURN false; END IF;
  UPDATE public.machine_defrost_runs
  SET state = 'manual_intervention', outcome = 'manual_intervention', completed_at = now(),
      failure_detail = 'Automated recovery stopped for audited manual control',
      lease_owner = NULL, lease_until = NULL, updated_at = now()
  WHERE id = v_run.id;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_before, state_after, actor_id, detail)
  VALUES (v_run.id, p_machine_id, 'manual_takeover_' || extract(epoch from clock_timestamp())::BIGINT,
    'manual_takeover', 'recovery', 'manual_intervention', p_admin_id,
    jsonb_build_object('reason', trim(p_reason)));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.take_over_defrost_recovery(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_over_defrost_recovery(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.request_manual_defrost(
  p_machine_id UUID,
  p_admin_id UUID,
  p_request_id UUID,
  p_allow_warnings BOOLEAN,
  p_override_reason TEXT
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
  v_warnings TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT * INTO v_run FROM public.machine_defrost_runs WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_run; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::TEXT, 0));
  SELECT * INTO v_machine FROM public.machines WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF v_machine.device_imei IS NULL OR length(trim(v_machine.device_imei)) = 0 THEN RAISE EXCEPTION 'Machine has no IMEI'; END IF;
  SELECT * INTO v_schedule FROM public.machine_defrost_schedules WHERE machine_id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Save a defrost duration before running defrost'; END IF;
  IF v_machine.deployed IS NOT TRUE THEN v_warnings := array_append(v_warnings, 'machine_not_deployed'); END IF;
  IF v_machine.is_online IS NOT TRUE THEN v_warnings := array_append(v_warnings, 'machine_offline'); END IF;
  IF v_schedule.requires_intervention THEN v_warnings := array_append(v_warnings, 'intervention_uncleared'); END IF;
  IF cardinality(v_warnings) > 0 AND (NOT p_allow_warnings OR length(trim(COALESCE(p_override_reason, ''))) < 5 OR length(p_override_reason) > 500) THEN
    RAISE EXCEPTION 'Operational warnings require an override reason: %', array_to_string(v_warnings, ', ');
  END IF;
  IF EXISTS (SELECT 1 FROM public.machine_command_leases WHERE machine_id = p_machine_id AND lease_until >= now()) THEN RAISE EXCEPTION 'Another machine command is in progress'; END IF;
  IF EXISTS (SELECT 1 FROM public.machine_defrost_runs WHERE machine_id = p_machine_id AND state IN ('scheduled','thawing','thaw_closed','refrigeration_check','forming','sales_check','recovery')) THEN RAISE EXCEPTION 'A defrost cycle is already active'; END IF;
  INSERT INTO public.machine_defrost_runs (schedule_id, machine_id, scheduled_local_date, scheduled_for, state, next_action_at, trigger_kind, requested_by, request_id, defrost_seconds_snapshot, formation_timeout_seconds_snapshot)
  VALUES (v_schedule.id, p_machine_id, (now() AT TIME ZONE v_schedule.time_zone)::DATE, now(), 'scheduled', now(), 'manual', p_admin_id, p_request_id, v_schedule.defrost_seconds, v_schedule.formation_timeout_seconds)
  RETURNING * INTO v_run;
  INSERT INTO public.machine_defrost_events (run_id, machine_id, event_key, event_type, state_after, actor_id, detail)
  VALUES (v_run.id, p_machine_id, 'cycle_requested', 'cycle_requested', 'scheduled', p_admin_id,
    jsonb_build_object('trigger_kind', 'manual', 'defrost_seconds', v_schedule.defrost_seconds, 'formation_timeout_seconds', v_schedule.formation_timeout_seconds,
      'warnings', to_jsonb(v_warnings), 'override_reason', CASE WHEN cardinality(v_warnings) > 0 THEN trim(p_override_reason) ELSE NULL END));
  RETURN v_run;
END;
$$;

REVOKE ALL ON FUNCTION public.request_manual_defrost(UUID, UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_manual_defrost(UUID, UUID, UUID, BOOLEAN, TEXT) TO service_role;
