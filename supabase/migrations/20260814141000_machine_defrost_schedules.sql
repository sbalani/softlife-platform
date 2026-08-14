CREATE TABLE public.machine_defrost_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL UNIQUE REFERENCES public.machines(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  local_start_time TIME NOT NULL DEFAULT '03:00',
  time_zone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  defrost_seconds INTEGER NOT NULL DEFAULT 240 CHECK (defrost_seconds BETWEEN 60 AND 1800),
  formation_timeout_seconds INTEGER NOT NULL DEFAULT 5400 CHECK (formation_timeout_seconds BETWEEN 600 AND 14400),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.machine_defrost_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.machine_defrost_schedules(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  scheduled_local_date DATE NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'thawing', 'thaw_closed', 'forming', 'completed', 'failed', 'manual_intervention')),
  next_action_at TIMESTAMPTZ NOT NULL,
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  formation_started_at TIMESTAMPTZ,
  last_formation_pct NUMERIC,
  last_status_observed_at TIMESTAMPTZ,
  failure_detail TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, scheduled_local_date)
);

CREATE UNIQUE INDEX machine_defrost_one_active_run_idx ON public.machine_defrost_runs (machine_id)
WHERE state IN ('scheduled', 'thawing', 'thaw_closed', 'forming');
CREATE INDEX machine_defrost_due_runs_idx ON public.machine_defrost_runs (next_action_at)
WHERE state IN ('scheduled', 'thawing', 'thaw_closed', 'forming');

CREATE TABLE public.machine_command_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.machine_defrost_runs(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  command TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'sending' CHECK (state IN ('sending', 'accepted', 'rejected', 'ambiguous')),
  huaxin_code TEXT,
  huaxin_message TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, step)
);

ALTER TABLE public.machine_defrost_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_defrost_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_command_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_defrost_schedules, public.machine_defrost_runs, public.machine_command_attempts FROM anon, authenticated;

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
  SELECT schedule.id, schedule.machine_id,
         (now() AT TIME ZONE schedule.time_zone)::DATE,
         (((now() AT TIME ZONE schedule.time_zone)::DATE + schedule.local_start_time) AT TIME ZONE schedule.time_zone),
         now()
  FROM public.machine_defrost_schedules schedule
  JOIN public.machines machine ON machine.id = schedule.machine_id
  WHERE schedule.enabled AND machine.deployed
    AND (now() AT TIME ZONE schedule.time_zone)::TIME >= schedule.local_start_time
    AND (now() AT TIME ZONE schedule.time_zone)::TIME < schedule.local_start_time + INTERVAL '10 minutes'
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
  SET lease_owner = p_owner, lease_until = now() + INTERVAL '2 minutes', updated_at = now()
  FROM due
  WHERE run.id = due.id
  RETURNING run.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_defrost_runs(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_defrost_runs(UUID, INTEGER) TO service_role;
