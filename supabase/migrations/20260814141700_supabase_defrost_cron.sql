CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.configure_defrost_cron(p_function_url TEXT, p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, cron, net
AS $$
DECLARE
  existing_job RECORD;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/defrost$' THEN
    RAISE EXCEPTION 'Invalid defrost function URL';
  END IF;
  IF length(p_token) < 32 THEN RAISE EXCEPTION 'Defrost cron token is too short'; END IF;

  DELETE FROM vault.secrets WHERE name = 'softlife_defrost_cron_token';
  PERFORM vault.create_secret(p_token, 'softlife_defrost_cron_token', 'Authenticates the pg_cron defrost Edge Function request');

  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'softlife-defrost-every-minute'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'softlife-defrost-every-minute',
    '* * * * *',
    format(
      $job$
        SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_defrost_cron_token')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 50000
        );
      $job$,
      p_function_url
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.configure_defrost_cron(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_defrost_cron(TEXT, TEXT) TO service_role;
