DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'machine_franchisee_assignments_time_excl') THEN
    ALTER TABLE public.machine_franchisee_assignments
      ADD CONSTRAINT machine_franchisee_assignments_time_excl EXCLUDE USING gist (
        machine_id WITH =,
        daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') WITH &&
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.replace_user_machine_assignments(
  p_user_id UUID,
  p_machine_ids UUID[],
  p_assigned_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_today DATE := (v_now AT TIME ZONE 'Europe/Madrid')::DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'operator') THEN
    RAISE EXCEPTION 'Only operators use explicit machine assignments';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_machine_ids, ARRAY[]::UUID[])) AS selected(machine_id) LEFT JOIN public.machines m ON m.id = selected.machine_id WHERE m.id IS NULL) THEN
    RAISE EXCEPTION 'Unknown machine selection';
  END IF;

  DELETE FROM public.user_machine_assignments
  WHERE user_id = p_user_id AND starts_at >= v_now
    AND NOT (machine_id = ANY(COALESCE(p_machine_ids, ARRAY[]::UUID[])));

  UPDATE public.user_machine_assignments
  SET ends_at = v_now, end_date = v_today
  WHERE user_id = p_user_id AND starts_at < v_now AND (ends_at IS NULL OR ends_at > v_now)
    AND NOT (machine_id = ANY(COALESCE(p_machine_ids, ARRAY[]::UUID[])));

  INSERT INTO public.user_machine_assignments (user_id, machine_id, start_date, starts_at, assigned_by)
  SELECT p_user_id, selected.machine_id, v_today, v_now, p_assigned_by
  FROM unnest(COALESCE(p_machine_ids, ARRAY[]::UUID[])) AS selected(machine_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_machine_assignments a
    WHERE a.user_id = p_user_id AND a.machine_id = selected.machine_id
      AND a.starts_at <= v_now AND (a.ends_at IS NULL OR a.ends_at >= v_now)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_machine_assignments(UUID, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_machine_assignments(UUID, UUID[], UUID) TO service_role;
