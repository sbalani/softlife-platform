CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.huaxin_status_shadow_targets (
  machine_id UUID PRIMARY KEY REFERENCES public.machines(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.huaxin_status_shadow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual', 'cron')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial_failure', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  machines_total INTEGER NOT NULL DEFAULT 0 CHECK (machines_total >= 0),
  machines_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (machines_succeeded >= 0),
  machines_failed INTEGER NOT NULL DEFAULT 0 CHECK (machines_failed >= 0),
  error TEXT
);

CREATE TABLE public.huaxin_status_shadow_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.huaxin_status_shadow_runs(id) ON DELETE CASCADE,
  machine_id UUID REFERENCES public.machines(id) ON DELETE SET NULL,
  machine_name TEXT,
  device_imei TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('supabase_direct', 'vercel_bridge')),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  fetched_at TIMESTAMPTZ,
  current_observed_at TIMESTAMPTZ,
  status_count INTEGER NOT NULL DEFAULT 0 CHECK (status_count >= 0),
  shadow_hash TEXT,
  current_hash TEXT,
  matches_current BOOLEAN,
  comparison_age_seconds INTEGER CHECK (comparison_age_seconds IS NULL OR comparison_age_seconds >= 0),
  comparison_fresh BOOLEAN,
  statuses JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, machine_id)
);

CREATE INDEX huaxin_status_shadow_runs_started_idx ON public.huaxin_status_shadow_runs(started_at DESC);
CREATE INDEX huaxin_status_shadow_results_machine_idx ON public.huaxin_status_shadow_results(machine_id, created_at DESC);
CREATE UNIQUE INDEX huaxin_status_shadow_one_running_idx ON public.huaxin_status_shadow_runs(status) WHERE status = 'running';

ALTER TABLE public.huaxin_status_shadow_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.huaxin_status_shadow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.huaxin_status_shadow_results ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_huaxin_status_shadow_run(p_trigger_source TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_run_id UUID;
BEGIN
  IF p_trigger_source NOT IN ('manual', 'cron') THEN RAISE EXCEPTION 'Invalid shadow trigger source'; END IF;
  PERFORM pg_advisory_xact_lock(8462947002);
  UPDATE public.huaxin_status_shadow_runs
  SET status = 'failed', finished_at = now(), error = 'Shadow worker did not finish within five minutes'
  WHERE status = 'running' AND started_at < now() - INTERVAL '5 minutes';
  IF EXISTS (SELECT 1 FROM public.huaxin_status_shadow_runs WHERE status = 'running') THEN RETURN NULL; END IF;
  INSERT INTO public.huaxin_status_shadow_runs(trigger_source) VALUES (p_trigger_source) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_huaxin_status_shadow_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT length(COALESCE(p_token, '')) >= 32
    AND EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'softlife_huaxin_status_shadow_token'
        AND decrypted_secret = p_token
    );
$$;

CREATE OR REPLACE FUNCTION public.configure_huaxin_status_shadow(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE generated_token TEXT; current_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/huaxin-status-shadow$' THEN
    RAISE EXCEPTION 'Invalid Huaxin status shadow function URL';
  END IF;
  SELECT decrypted_secret INTO current_token
  FROM vault.decrypted_secrets
  WHERE name = 'softlife_huaxin_status_shadow_token';
  IF current_token IS NULL THEN
    generated_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(generated_token, 'softlife_huaxin_status_shadow_token', 'Authenticates manual Huaxin status shadow runs');
  END IF;
  DELETE FROM vault.secrets WHERE name = 'softlife_huaxin_status_shadow_function_url';
  PERFORM vault.create_secret(p_function_url, 'softlife_huaxin_status_shadow_function_url', 'Supabase Huaxin status shadow worker URL');
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_huaxin_status_shadow()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE v_url TEXT; v_token TEXT; v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'softlife_huaxin_status_shadow_function_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'softlife_huaxin_status_shadow_token';
  IF v_url IS NULL OR v_token IS NULL THEN RAISE EXCEPTION 'Huaxin status shadow worker is not configured'; END IF;
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-shadow-token', v_token),
    body := jsonb_build_object('trigger_source', 'manual'),
    timeout_milliseconds := 120000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON TABLE public.huaxin_status_shadow_targets, public.huaxin_status_shadow_runs, public.huaxin_status_shadow_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_huaxin_status_shadow_run(TEXT), public.verify_huaxin_status_shadow_token(TEXT), public.configure_huaxin_status_shadow(TEXT), public.trigger_huaxin_status_shadow() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_huaxin_status_shadow_run(TEXT), public.verify_huaxin_status_shadow_token(TEXT), public.configure_huaxin_status_shadow(TEXT), public.trigger_huaxin_status_shadow() TO service_role;
