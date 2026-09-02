CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.order_sync_lock (
  key TEXT PRIMARY KEY CHECK (key = 'orders'),
  owner_token UUID,
  locked_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity'
);

INSERT INTO public.order_sync_lock (key) VALUES ('orders');
ALTER TABLE public.order_sync_lock ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.claim_order_sync_lock(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.order_sync_lock
  SET owner_token = p_owner, locked_until = now() + INTERVAL '10 minutes'
  WHERE key = 'orders' AND locked_until < now();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.release_order_sync_lock(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.order_sync_lock
  SET owner_token = NULL, locked_until = '-infinity'
  WHERE key = 'orders' AND owner_token = p_owner;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.renew_order_sync_lock(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.order_sync_lock
  SET locked_until = now() + INTERVAL '10 minutes'
  WHERE key = 'orders' AND owner_token = p_owner AND locked_until >= now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_order_sync_cron_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT length(COALESCE(p_token, '')) >= 32
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'softlife_order_sync_cron_token'
        AND decrypted_secret = p_token
    );
$$;

CREATE OR REPLACE FUNCTION public.configure_order_sync_cron(p_endpoint_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, net
AS $$
DECLARE
  existing_job RECORD;
  generated_token TEXT;
BEGIN
  IF p_endpoint_url <> 'https://platform.softlife.es/api/cron/order-sync' THEN
    RAISE EXCEPTION 'Invalid order sync endpoint URL';
  END IF;

  generated_token := encode(extensions.gen_random_bytes(32), 'hex');
  DELETE FROM vault.secrets WHERE name = 'softlife_order_sync_cron_token';
  PERFORM vault.create_secret(generated_token, 'softlife_order_sync_cron_token', 'Authenticates the 15-minute order reconciliation request');

  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'softlife-order-sync-every-15-minutes'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'softlife-order-sync-every-15-minutes',
    '*/15 * * * *',
    format(
      $job$
        SELECT net.http_get(
          url := %L,
          headers := jsonb_build_object(
            'x-supabase-cron-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_order_sync_cron_token')
          ),
          timeout_milliseconds := 300000
        );
      $job$,
      p_endpoint_url
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_order_sync_cron_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_order_sync_cron(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.order_sync_lock FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_order_sync_lock(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_order_sync_lock(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_order_sync_lock(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_order_sync_cron_token(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.configure_order_sync_cron(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_order_sync_lock(UUID), public.release_order_sync_lock(UUID), public.renew_order_sync_lock(UUID) TO service_role;

SELECT public.configure_order_sync_cron('https://platform.softlife.es/api/cron/order-sync');
