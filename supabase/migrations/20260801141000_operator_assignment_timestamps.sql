ALTER TABLE public.user_machine_assignments
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

UPDATE public.user_machine_assignments
SET starts_at = start_date::TIMESTAMP AT TIME ZONE 'Europe/Madrid',
    ends_at = CASE WHEN end_date IS NULL THEN NULL ELSE (end_date + 1)::TIMESTAMP AT TIME ZONE 'Europe/Madrid' - INTERVAL '1 microsecond' END
WHERE starts_at IS NULL;

ALTER TABLE public.user_machine_assignments ALTER COLUMN starts_at SET DEFAULT now();
ALTER TABLE public.user_machine_assignments ALTER COLUMN starts_at SET NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.user_machine_assignments'::regclass AND contype = 'x'
  LOOP
    EXECUTE format('ALTER TABLE public.user_machine_assignments DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.user_machine_assignments
  ADD CONSTRAINT user_machine_assignments_time_excl EXCLUDE USING gist (
    user_id WITH =,
    machine_id WITH =,
    tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[]') WITH &&
  );

CREATE INDEX IF NOT EXISTS user_machine_assignments_user_time_idx
  ON public.user_machine_assignments(user_id, starts_at, ends_at);
