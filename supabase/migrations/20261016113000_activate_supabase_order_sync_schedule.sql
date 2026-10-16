CREATE OR REPLACE FUNCTION public.configure_huaxin_order_sync_schedule(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, cron, net
AS $$
DECLARE existing_job RECORD;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'softlife-order-sync-every-15-minutes'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  IF NOT p_enabled THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'softlife_order_sync_function_url' AND decrypted_secret IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'softlife_order_sync_cron_token' AND decrypted_secret IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Huaxin order sync worker is not configured';
  END IF;

  PERFORM cron.schedule(
    'softlife-order-sync-every-15-minutes',
    '*/15 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_order_sync_function_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-order-sync-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_order_sync_cron_token')
        ),
        body := jsonb_build_object('trigger_source', 'cron'),
        timeout_milliseconds := 300000
      );
    $job$
  );
END;
$$;

REVOKE ALL ON FUNCTION public.configure_huaxin_order_sync_schedule(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_huaxin_order_sync_schedule(BOOLEAN) TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'softlife_order_sync_function_url' AND decrypted_secret IS NOT NULL
  ) AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'softlife_order_sync_cron_token' AND decrypted_secret IS NOT NULL
  ) THEN
    PERFORM public.configure_huaxin_order_sync_schedule(true);
  END IF;
END;
$$;
