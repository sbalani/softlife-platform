CREATE TABLE public.machine_pasteurization_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  series_name TEXT,
  anchor_date DATE NOT NULL,
  interval_days SMALLINT NOT NULL CHECK (interval_days BETWEEN 1 AND 3),
  start_local TIME NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 30 AND 720),
  time_zone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX machine_pasteurization_schedule_lookup
  ON public.machine_pasteurization_schedules (machine_id, enabled, anchor_date);

CREATE TABLE public.pasteurization_window_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  series_name TEXT NOT NULL,
  observed_start TIMESTAMPTZ NOT NULL,
  observed_end TIMESTAMPTZ NOT NULL,
  minimum_celsius DOUBLE PRECISION NOT NULL,
  maximum_celsius DOUBLE PRECISION NOT NULL,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 3),
  maximum_gap_minutes DOUBLE PRECISION NOT NULL,
  suggested_anchor_date DATE NOT NULL,
  suggested_start_local TIME NOT NULL,
  suggested_duration_minutes INTEGER NOT NULL CHECK (suggested_duration_minutes BETWEEN 30 AND 720),
  suggested_interval_days SMALLINT NOT NULL CHECK (suggested_interval_days BETWEEN 1 AND 3),
  time_zone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (machine_id, series_name, observed_start),
  CHECK (observed_end > observed_start)
);

CREATE INDEX pasteurization_suggestions_pending
  ON public.pasteurization_window_suggestions (status, observed_start DESC)
  WHERE status = 'pending';

CREATE TABLE public.pasteurization_alert_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  temperature_id UUID NOT NULL UNIQUE REFERENCES public.huaxin_temperatures(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES public.machine_pasteurization_schedules(id) ON DELETE RESTRICT,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  series_name TEXT NOT NULL,
  reading_time TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pasteurization_suppressions_machine_time
  ON public.pasteurization_alert_suppressions (machine_id, reading_time DESC);

CREATE OR REPLACE FUNCTION public.validate_pasteurization_time_zone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.time_zone) THEN
    RAISE EXCEPTION 'Invalid pasteurization time zone';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER machine_pasteurization_schedule_time_zone
BEFORE INSERT OR UPDATE OF time_zone ON public.machine_pasteurization_schedules
FOR EACH ROW EXECUTE FUNCTION public.validate_pasteurization_time_zone();
CREATE TRIGGER pasteurization_suggestion_time_zone
BEFORE INSERT OR UPDATE OF time_zone ON public.pasteurization_window_suggestions
FOR EACH ROW EXECUTE FUNCTION public.validate_pasteurization_time_zone();

ALTER TABLE public.machine_pasteurization_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasteurization_window_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasteurization_alert_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pasteurization_schedules_admin ON public.machine_pasteurization_schedules
  FOR SELECT TO authenticated USING (public.is_current_admin());
CREATE POLICY pasteurization_suggestions_admin ON public.pasteurization_window_suggestions
  FOR SELECT TO authenticated USING (public.is_current_admin());
CREATE POLICY pasteurization_suppressions_admin ON public.pasteurization_alert_suppressions
  FOR SELECT TO authenticated USING (public.is_current_admin());

REVOKE ALL ON public.machine_pasteurization_schedules, public.pasteurization_window_suggestions, public.pasteurization_alert_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.machine_pasteurization_schedules, public.pasteurization_window_suggestions, public.pasteurization_alert_suppressions TO authenticated;
GRANT ALL ON public.machine_pasteurization_schedules, public.pasteurization_window_suggestions, public.pasteurization_alert_suppressions TO service_role;

CREATE OR REPLACE FUNCTION public.active_machine_pasteurization_schedule(
  p_machine_id UUID, p_series_name TEXT, p_reading_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT schedule.id
  FROM public.machine_pasteurization_schedules schedule
  CROSS JOIN LATERAL (
    SELECT (p_reading_at AT TIME ZONE schedule.time_zone)::DATE AS local_day
  ) local_time
  CROSS JOIN LATERAL (
    VALUES (local_time.local_day), (local_time.local_day - 1)
  ) candidate(day)
  WHERE schedule.enabled
    AND schedule.machine_id = p_machine_id
    AND (schedule.series_name IS NULL OR public.normalize_temperature_series(schedule.series_name) = public.normalize_temperature_series(p_series_name))
    AND candidate.day >= schedule.anchor_date
    AND mod(candidate.day - schedule.anchor_date, schedule.interval_days) = 0
    AND p_reading_at >= ((candidate.day + schedule.start_local) AT TIME ZONE schedule.time_zone)
    AND p_reading_at < ((candidate.day + schedule.start_local) AT TIME ZONE schedule.time_zone) + make_interval(mins => schedule.duration_minutes)
  ORDER BY (schedule.series_name IS NOT NULL) DESC, schedule.created_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.accept_pasteurization_window_suggestion(
  p_suggestion_id UUID, p_actor_id UUID, p_anchor_date DATE, p_interval_days INTEGER,
  p_start_local TIME, p_duration_minutes INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_suggestion public.pasteurization_window_suggestions%ROWTYPE; v_schedule_id UUID;
BEGIN
  IF p_interval_days NOT BETWEEN 1 AND 3 OR p_duration_minutes NOT BETWEEN 30 AND 720 THEN
    RAISE EXCEPTION 'Invalid pasteurization schedule';
  END IF;
  SELECT * INTO v_suggestion FROM public.pasteurization_window_suggestions
  WHERE id = p_suggestion_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pasteurization suggestion is no longer pending'; END IF;
  INSERT INTO public.machine_pasteurization_schedules (
    machine_id, series_name, anchor_date, interval_days, start_local, duration_minutes, time_zone, created_by
  ) VALUES (
    v_suggestion.machine_id, v_suggestion.series_name, p_anchor_date, p_interval_days,
    p_start_local, p_duration_minutes, v_suggestion.time_zone, p_actor_id
  ) RETURNING id INTO v_schedule_id;
  UPDATE public.pasteurization_window_suggestions
  SET status = 'accepted', reviewed_by = p_actor_id, reviewed_at = now()
  WHERE id = p_suggestion_id;
  RETURN v_schedule_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_temperature_for_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE machine_row public.machines%ROWTYPE; active_schedule_id UUID; current_series TEXT;
BEGIN
  IF NEW.machine_id IS NULL OR NEW.value IS NULL THEN RETURN NEW; END IF;
  current_series := public.normalize_temperature_series(COALESCE(NEW.series_name, 'temperature'));
  active_schedule_id := public.active_machine_pasteurization_schedule(NEW.machine_id, NEW.series_name, NEW.reading_time);
  IF active_schedule_id IS NOT NULL AND NEW.value >= 10 AND NEW.value <= 65 THEN
    INSERT INTO public.pasteurization_alert_suppressions (
      temperature_id, schedule_id, machine_id, series_name, reading_time, value
    ) VALUES (NEW.id, active_schedule_id, NEW.machine_id, COALESCE(NEW.series_name, 'temperature'), NEW.reading_time, NEW.value)
    ON CONFLICT (temperature_id) DO NOTHING;
    UPDATE public.alerts alert SET resolved_at = now()
    FROM public.change_alert_rules rule, public.machine_change_log observation
    WHERE alert.change_alert_rule_id = rule.id
      AND alert.change_log_id = observation.id
      AND alert.machine_id = NEW.machine_id
      AND alert.resolved_at IS NULL
      AND rule.field = 'temperature'
      AND public.normalize_temperature_series(alert.entity_key) = current_series
      AND (rule.series_name IS NULL OR public.normalize_temperature_series(rule.series_name) = current_series)
      AND COALESCE(NULLIF(observation.metadata->>'reading_time', '')::TIMESTAMPTZ, observation.created_at) <= NEW.reading_time;
    RETURN NEW;
  END IF;
  SELECT * INTO machine_row FROM public.machines WHERE id = NEW.machine_id;
  INSERT INTO public.machine_change_log (
    machine_id, device_imei, machine_name, source, action, entity_type,
    entity_key, field, new_value, metadata
  ) VALUES (
    NEW.machine_id, machine_row.device_imei, machine_row.name, 'machine_sync',
    'observed', 'temperature', COALESCE(NEW.series_name, 'temperature'),
    'temperature', to_jsonb(NEW.value), jsonb_build_object('series_name', NEW.series_name, 'reading_time', NEW.reading_time)
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.active_machine_pasteurization_schedule(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_pasteurization_window_suggestion(UUID, UUID, DATE, INTEGER, TIME, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_pasteurization_time_zone() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.active_machine_pasteurization_schedule(UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_pasteurization_window_suggestion(UUID, UUID, DATE, INTEGER, TIME, INTEGER) TO service_role;
