CREATE TABLE public.huaxin_status_worker_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'authoritative')),
  target_scope TEXT NOT NULL DEFAULT 'targets' CHECK (target_scope IN ('targets', 'all_deployed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.huaxin_status_worker_config(singleton, mode, target_scope)
VALUES (true, 'shadow', 'targets')
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.huaxin_status_worker_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.huaxin_status_worker_config FROM PUBLIC, anon, authenticated;

ALTER TABLE public.huaxin_status_shadow_runs
  ADD COLUMN worker_mode TEXT NOT NULL DEFAULT 'shadow' CHECK (worker_mode IN ('shadow', 'authoritative')),
  ADD COLUMN target_scope TEXT NOT NULL DEFAULT 'targets' CHECK (target_scope IN ('targets', 'all_deployed'));

ALTER TABLE public.huaxin_status_shadow_results
  ADD COLUMN write_accepted BOOLEAN,
  ADD COLUMN write_reason TEXT;

CREATE OR REPLACE FUNCTION public.configure_huaxin_status_worker(p_mode TEXT, p_target_scope TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_mode NOT IN ('shadow', 'authoritative') THEN
    RAISE EXCEPTION 'Invalid Huaxin status worker mode';
  END IF;
  IF p_target_scope NOT IN ('targets', 'all_deployed') THEN
    RAISE EXCEPTION 'Invalid Huaxin status worker target scope';
  END IF;

  INSERT INTO public.huaxin_status_worker_config(singleton, mode, target_scope, updated_at)
  VALUES (true, p_mode, p_target_scope, now())
  ON CONFLICT (singleton) DO UPDATE
  SET mode = EXCLUDED.mode,
      target_scope = EXCLUDED.target_scope,
      updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_huaxin_machine_status(
  p_machine_id UUID,
  p_observed_at TIMESTAMPTZ,
  p_statuses JSONB,
  p_signals JSONB,
  p_writer TEXT DEFAULT 'platform'
)
RETURNS TABLE(accepted BOOLEAN, reason TEXT, accepted_observed_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  machine_row RECORD;
  current_observed_at TIMESTAMPTZ;
BEGIN
  IF jsonb_typeof(p_statuses) IS DISTINCT FROM 'array' OR jsonb_array_length(p_statuses) = 0 THEN
    RAISE EXCEPTION 'Huaxin status payload must be a non-empty array';
  END IF;
  IF jsonb_typeof(p_signals) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Huaxin status signals must be an array';
  END IF;
  IF p_observed_at IS NULL OR p_observed_at > now() + INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'Invalid Huaxin status observation time';
  END IF;
  IF COALESCE(btrim(p_writer), '') = '' THEN
    RAISE EXCEPTION 'Huaxin status writer is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::TEXT, 8462947003));

  SELECT id, device_imei, COALESCE(display_name, name, device_imei) AS machine_name
  INTO machine_row
  FROM public.machines
  WHERE id = p_machine_id;

  IF machine_row.id IS NULL THEN
    RAISE EXCEPTION 'Machine not found';
  END IF;

  SELECT max(observed_at)
  INTO current_observed_at
  FROM public.machine_status_snapshots
  WHERE machine_id = p_machine_id AND field LIKE 'raw:%';

  IF current_observed_at IS NOT NULL AND current_observed_at >= p_observed_at THEN
    RETURN QUERY SELECT false, 'stale'::TEXT, current_observed_at;
    RETURN;
  END IF;

  INSERT INTO public.machine_change_log(
    machine_id, device_imei, machine_name, source, action, entity_type,
    entity_key, field, old_value, new_value, metadata
  )
  SELECT
    p_machine_id,
    machine_row.device_imei,
    machine_row.machine_name,
    'machine_sync',
    CASE
      WHEN snapshot.field IS NOT NULL AND snapshot.value IS DISTINCT FROM signal.item->'value' THEN 'status_changed'
      ELSE 'observed'
    END,
    'machine_status',
    signal.item->>'field',
    signal.item->>'field',
    snapshot.value,
    signal.item->'value',
    jsonb_build_object(
      'description', signal.item->'raw'->'desc',
      'raw_value', signal.item->'raw'->'value',
      'raw_data', signal.item->'raw'->'data',
      'writer', p_writer,
      'observed_at', p_observed_at
    )
  FROM jsonb_array_elements(p_signals) AS signal(item)
  LEFT JOIN public.machine_status_snapshots snapshot
    ON snapshot.machine_id = p_machine_id
   AND snapshot.field = signal.item->>'field'
  WHERE COALESCE(signal.item->>'field', '') <> ''
    AND signal.item ? 'value';

  INSERT INTO public.machine_status_snapshots(machine_id, field, value, raw, observed_at)
  SELECT
    p_machine_id,
    signal.item->>'field',
    signal.item->'value',
    COALESCE(signal.item->'raw', '{}'::JSONB),
    p_observed_at
  FROM jsonb_array_elements(p_signals) AS signal(item)
  WHERE COALESCE(signal.item->>'field', '') <> ''
    AND signal.item ? 'value'
  ON CONFLICT (machine_id, field) DO UPDATE
  SET value = EXCLUDED.value,
      raw = EXCLUDED.raw,
      observed_at = EXCLUDED.observed_at;

  WITH raw_rows AS (
    SELECT DISTINCT ON (field)
      field,
      item,
      ordinal
    FROM (
      SELECT
        'raw:' || COALESCE(NULLIF(status.item->>'code', ''), 'index:' || status.ordinal::TEXT) AS field,
        status.item,
        status.ordinal
      FROM jsonb_array_elements(p_statuses) WITH ORDINALITY AS status(item, ordinal)
    ) statuses
    ORDER BY field, ordinal DESC
  )
  INSERT INTO public.machine_status_snapshots(machine_id, field, value, raw, observed_at)
  SELECT
    p_machine_id,
    raw_rows.field,
    COALESCE(NULLIF(raw_rows.item->'value', 'null'::JSONB), NULLIF(raw_rows.item->'data', 'null'::JSONB), '""'::JSONB),
    raw_rows.item,
    p_observed_at
  FROM raw_rows
  ON CONFLICT (machine_id, field) DO UPDATE
  SET value = EXCLUDED.value,
      raw = EXCLUDED.raw,
      observed_at = EXCLUDED.observed_at;

  DELETE FROM public.machine_status_snapshots snapshot
  WHERE snapshot.machine_id = p_machine_id
    AND snapshot.field LIKE 'raw:%'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_statuses) WITH ORDINALITY AS status(item, ordinal)
      WHERE snapshot.field = 'raw:' || COALESCE(NULLIF(status.item->>'code', ''), 'index:' || status.ordinal::TEXT)
    );

  RETURN QUERY SELECT true, 'accepted'::TEXT, p_observed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_huaxin_status_shadow_schedule(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, cron, net
AS $$
DECLARE existing_job RECORD;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'softlife-huaxin-status-shadow-every-30-minutes'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  IF NOT p_enabled THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'softlife_huaxin_status_shadow_function_url' AND decrypted_secret IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'softlife_huaxin_status_shadow_token' AND decrypted_secret IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Huaxin status worker is not configured';
  END IF;

  PERFORM cron.schedule(
    'softlife-huaxin-status-shadow-every-30-minutes',
    '7,37 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_huaxin_status_shadow_function_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-shadow-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_huaxin_status_shadow_token')
        ),
        body := jsonb_build_object('trigger_source', 'cron'),
        timeout_milliseconds := 120000
      );
    $job$
  );
END;
$$;

REVOKE ALL ON FUNCTION public.configure_huaxin_status_worker(TEXT, TEXT), public.ingest_huaxin_machine_status(UUID, TIMESTAMPTZ, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_huaxin_status_worker(TEXT, TEXT), public.ingest_huaxin_machine_status(UUID, TIMESTAMPTZ, JSONB, JSONB, TEXT) TO service_role;
