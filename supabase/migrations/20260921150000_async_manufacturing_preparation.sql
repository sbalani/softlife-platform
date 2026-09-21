ALTER TABLE public.manufacturing_period_exports
  ADD COLUMN preparation_requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN preparation_stage TEXT,
  ADD COLUMN preparation_claim_token UUID,
  ADD COLUMN preparation_lease_until TIMESTAMPTZ,
  ADD COLUMN preparation_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN preparation_started_at TIMESTAMPTZ,
  ADD COLUMN preparation_completed_at TIMESTAMPTZ,
  ADD COLUMN preparation_error TEXT;

UPDATE public.manufacturing_period_exports
SET preparation_stage = CASE WHEN status = 'preparing' THEN 'queued' ELSE status END,
    preparation_completed_at = CASE WHEN status <> 'preparing' THEN updated_at END;

ALTER TABLE public.manufacturing_period_exports
  ALTER COLUMN preparation_stage SET DEFAULT 'queued',
  ALTER COLUMN preparation_stage SET NOT NULL,
  ADD CONSTRAINT manufacturing_preparation_stage_check CHECK (preparation_stage IN (
    'queued', 'preparing', 'draft', 'blocked', 'replenishment_planning', 'replenishment_ready',
    'replenishment_failed', 'failed', 'cancelled', 'ready', 'processing', 'completed'
  ));

CREATE INDEX manufacturing_preparation_due_idx
  ON public.manufacturing_period_exports (preparation_lease_until, created_at)
  WHERE status = 'preparing';

CREATE OR REPLACE FUNCTION public.verify_manufacturing_preparation_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT p_token IS NOT NULL AND p_token = (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_manufacturing_preparation_token' LIMIT 1
  )
$$;

CREATE OR REPLACE FUNCTION public.claim_manufacturing_preparation()
RETURNS public.manufacturing_period_exports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_token UUID := gen_random_uuid();
BEGIN
  SELECT * INTO v_export
  FROM public.manufacturing_period_exports
  WHERE status = 'preparing' AND (preparation_lease_until IS NULL OR preparation_lease_until < now())
  ORDER BY created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.manufacturing_period_exports SET
    preparation_stage = 'processing', preparation_claim_token = v_token,
    preparation_lease_until = now() + INTERVAL '10 minutes',
    preparation_attempt_count = preparation_attempt_count + 1,
    preparation_started_at = COALESCE(preparation_started_at, now()), preparation_error = NULL
  WHERE id = v_export.id RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_manufacturing_export_worker(
  p_export_id UUID, p_claim_token UUID, p_expected_orders JSONB, p_payload JSONB,
  p_payload_sha256 TEXT, p_config_snapshot JSONB, p_blocked_reasons JSONB
)
RETURNS public.manufacturing_period_exports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_current public.manufacturing_period_exports%ROWTYPE; v_export public.manufacturing_period_exports%ROWTYPE; v_title TEXT; v_message TEXT;
BEGIN
  SELECT * INTO v_current FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND OR v_current.status <> 'preparing' OR v_current.preparation_claim_token IS DISTINCT FROM p_claim_token
    OR v_current.preparation_lease_until <= now() THEN
    RAISE EXCEPTION 'Manufacturing preparation claim expired' USING ERRCODE = 'P0001';
  END IF;
  v_export := public.finalize_manufacturing_export(
    p_export_id, p_expected_orders, p_payload, p_payload_sha256, p_config_snapshot, p_blocked_reasons
  );
  UPDATE public.manufacturing_period_exports SET
    preparation_stage = v_export.status, preparation_claim_token = NULL, preparation_lease_until = NULL,
    preparation_completed_at = now(), preparation_error = NULL
  WHERE id = p_export_id RETURNING * INTO v_export;

  v_title := CASE v_export.status
    WHEN 'blocked' THEN 'Manufacturing preview needs review'
    WHEN 'replenishment_planning' THEN 'Manufacturing preview needs replenishment'
    ELSE 'Manufacturing preview is ready'
  END;
  v_message := format('The manufacturing preview for %s through %s finished with status %s.',
    v_export.period_from::DATE, (v_export.period_to - INTERVAL '1 second')::DATE, v_export.status);
  INSERT INTO public.alerts (tenant_id, type, severity, machine_id, entity_key, title, message, mobile_notification)
  SELECT NULL, 'manufacturing_preview_ready', CASE WHEN v_export.status = 'blocked' THEN 'warning' ELSE 'info' END,
    NULL, v_export.id::TEXT, v_title, v_message, true
  WHERE NOT EXISTS (SELECT 1 FROM public.alerts WHERE type = 'manufacturing_preview_ready' AND entity_key = v_export.id::TEXT AND resolved_at IS NULL);
  RETURN v_export;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_manufacturing_export_preparation(p_export_id UUID, p_claim_token UUID, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  UPDATE public.manufacturing_period_exports SET
    status = 'failed', preparation_stage = 'failed', preparation_claim_token = NULL, preparation_lease_until = NULL,
    preparation_completed_at = now(), preparation_error = left(COALESCE(p_error, 'Unknown preparation failure'), 4000),
    blocked_reasons = jsonb_build_array(jsonb_build_object('problem_code', 'preparation_failed', 'message', left(COALESCE(p_error, 'Unknown preparation failure'), 4000)))
  WHERE id = p_export_id AND status = 'preparing' AND preparation_claim_token = p_claim_token
  RETURNING * INTO v_export;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.alerts (tenant_id, type, severity, machine_id, entity_key, title, message, mobile_notification)
  SELECT NULL, 'manufacturing_preview_failed', 'critical', NULL, v_export.id::TEXT,
    'Manufacturing preview failed', format('The manufacturing preview for %s through %s failed: %s',
      v_export.period_from::DATE, (v_export.period_to - INTERVAL '1 second')::DATE, v_export.preparation_error), true
  WHERE NOT EXISTS (SELECT 1 FROM public.alerts WHERE type = 'manufacturing_preview_failed' AND entity_key = v_export.id::TEXT AND resolved_at IS NULL);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_manufacturing_preparation_worker(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, net
AS $$
DECLARE existing_job RECORD; generated_token TEXT; current_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/manufacturing-preparation$' THEN
    RAISE EXCEPTION 'Invalid manufacturing preparation function URL';
  END IF;
  SELECT decrypted_secret INTO current_token FROM vault.decrypted_secrets WHERE name = 'softlife_manufacturing_preparation_token';
  IF current_token IS NULL THEN
    generated_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(generated_token, 'softlife_manufacturing_preparation_token', 'Authenticates manufacturing preparation worker requests');
  END IF;
  DELETE FROM vault.secrets WHERE name = 'softlife_manufacturing_preparation_function_url';
  PERFORM vault.create_secret(p_function_url, 'softlife_manufacturing_preparation_function_url', 'Manufacturing preparation Edge Function URL');
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'softlife-manufacturing-preparation-every-minute' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'softlife-manufacturing-preparation-every-minute', '* * * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_manufacturing_preparation_token')),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      )
      WHERE EXISTS (SELECT 1 FROM public.manufacturing_period_exports
        WHERE status = 'preparing' AND (preparation_lease_until IS NULL OR preparation_lease_until < now()));
    $job$, p_function_url)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.wake_manufacturing_preparation_worker()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE v_url TEXT; v_token TEXT;
BEGIN
  IF NEW.status <> 'preparing' THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'softlife_manufacturing_preparation_function_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'softlife_manufacturing_preparation_token';
  IF v_url IS NULL OR v_token IS NULL THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manufacturing_preparation_wakeup ON public.manufacturing_period_exports;
CREATE TRIGGER manufacturing_preparation_wakeup
AFTER INSERT ON public.manufacturing_period_exports
FOR EACH ROW EXECUTE FUNCTION public.wake_manufacturing_preparation_worker();

REVOKE ALL ON FUNCTION public.verify_manufacturing_preparation_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_manufacturing_preparation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_manufacturing_export_worker(UUID, UUID, JSONB, JSONB, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_manufacturing_export_preparation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_manufacturing_preparation_worker(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wake_manufacturing_preparation_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_manufacturing_preparation_token(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_manufacturing_preparation() TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_manufacturing_export_worker(UUID, UUID, JSONB, JSONB, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_manufacturing_export_preparation(UUID, UUID, TEXT) TO service_role;

SELECT public.configure_manufacturing_preparation_worker('https://awsfqnymosevmhawbukf.supabase.co/functions/v1/manufacturing-preparation');
