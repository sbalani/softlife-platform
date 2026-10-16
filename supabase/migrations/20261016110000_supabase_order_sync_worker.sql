ALTER TABLE public.order_sync_runs
  ADD COLUMN executor TEXT NOT NULL DEFAULT 'vercel'
  CHECK (executor IN ('vercel', 'supabase_edge'));

CREATE OR REPLACE FUNCTION public.claim_order_sync_lock(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.order_sync_lock
  SET owner_token = p_owner, locked_until = now() + INTERVAL '10 minutes'
  WHERE key = 'orders' AND locked_until < now();
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.order_sync_runs
  SET status = 'failed', finished_at = now(), error = COALESCE(error, 'Order sync lease expired before completion')
  WHERE status = 'running';
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_huaxin_order_sync_worker(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE generated_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/huaxin-order-sync$' THEN
    RAISE EXCEPTION 'Invalid Huaxin order sync function URL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'softlife_order_sync_cron_token' AND decrypted_secret IS NOT NULL) THEN
    generated_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(generated_token, 'softlife_order_sync_cron_token', 'Authenticates Supabase order reconciliation');
  END IF;
  DELETE FROM vault.secrets WHERE name = 'softlife_order_sync_function_url';
  PERFORM vault.create_secret(p_function_url, 'softlife_order_sync_function_url', 'Supabase Huaxin order sync worker URL');
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_huaxin_order_sync(p_from DATE, p_to DATE, p_device_imeis TEXT[] DEFAULT '{}')
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE v_url TEXT; v_token TEXT; v_request_id BIGINT;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 92 THEN RAISE EXCEPTION 'Invalid order sync date range'; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'softlife_order_sync_function_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'softlife_order_sync_cron_token';
  IF v_url IS NULL OR v_token IS NULL THEN RAISE EXCEPTION 'Huaxin order sync worker is not configured'; END IF;
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-order-sync-token', v_token),
    body := jsonb_build_object('trigger_source', 'settings', 'from', p_from, 'to', p_to, 'device_imeis', COALESCE(p_device_imeis, '{}')),
    timeout_milliseconds := 300000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_huaxin_order_sync_worker(TEXT), public.trigger_huaxin_order_sync(DATE, DATE, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_huaxin_order_sync_worker(TEXT), public.trigger_huaxin_order_sync(DATE, DATE, TEXT[]) TO service_role;
