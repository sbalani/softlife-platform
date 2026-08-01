ALTER TABLE public.clean_logs ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.reposiciones ALTER COLUMN tenant_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clean_logs_operator_id_fkey') THEN
    ALTER TABLE public.clean_logs ADD CONSTRAINT clean_logs_operator_id_fkey
      FOREIGN KEY (operator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clean_logs_kind_check') THEN
    ALTER TABLE public.clean_logs ADD CONSTRAINT clean_logs_kind_check CHECK (kind IN ('full', 'partial'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clean_logs_machine_time_idx ON public.clean_logs (machine_id, device_event_time DESC);
CREATE INDEX IF NOT EXISTS reposiciones_machine_time_idx ON public.reposiciones (machine_id, device_event_time DESC);

CREATE OR REPLACE FUNCTION public.record_machine_clean(
  p_machine_id UUID,
  p_client_uuid UUID,
  p_operator_id UUID,
  p_kind TEXT,
  p_device_event_time TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_last_clean TIMESTAMPTZ;
BEGIN
  IF p_kind NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'Invalid cleaning kind';
  END IF;

  SELECT COALESCE(m.tenant_id, assignment.tenant_id)
  INTO v_tenant_id
  FROM public.machines m
  LEFT JOIN LATERAL (
    SELECT a.tenant_id
    FROM public.machine_franchisee_assignments a
    WHERE a.machine_id = m.id
      AND a.start_date <= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
      AND (a.end_date IS NULL OR a.end_date >= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
    ORDER BY a.start_date DESC
    LIMIT 1
  ) assignment ON TRUE
  WHERE m.id = p_machine_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;

  INSERT INTO public.clean_logs (tenant_id, client_uuid, machine_id, operator_id, kind, device_event_time)
  VALUES (v_tenant_id, p_client_uuid, p_machine_id, p_operator_id, p_kind, p_device_event_time)
  ON CONFLICT (client_uuid) DO NOTHING;

  IF p_kind = 'full' THEN
    UPDATE public.machines
    SET last_full_clean_date = GREATEST(COALESCE(last_full_clean_date, p_device_event_time), p_device_event_time)
    WHERE id = p_machine_id;
  END IF;

  SELECT last_full_clean_date INTO v_last_clean FROM public.machines WHERE id = p_machine_id;
  RETURN v_last_clean;
END;
$$;

REVOKE ALL ON FUNCTION public.record_machine_clean(UUID, UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_machine_clean(UUID, UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;

INSERT INTO public.clean_logs (tenant_id, client_uuid, machine_id, operator_id, kind, device_event_time)
SELECT assignment.tenant_id, gen_random_uuid(), m.id, NULL, 'full', m.last_full_clean_date
FROM public.machines m
LEFT JOIN LATERAL (
  SELECT a.tenant_id
  FROM public.machine_franchisee_assignments a
  WHERE a.machine_id = m.id
    AND a.start_date <= (m.last_full_clean_date AT TIME ZONE 'Europe/Madrid')::DATE
    AND (a.end_date IS NULL OR a.end_date >= (m.last_full_clean_date AT TIME ZONE 'Europe/Madrid')::DATE)
  ORDER BY a.start_date DESC
  LIMIT 1
) assignment ON TRUE
WHERE m.last_full_clean_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.clean_logs c
    WHERE c.machine_id = m.id AND c.kind = 'full' AND c.device_event_time = m.last_full_clean_date
  );
