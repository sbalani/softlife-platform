DO $$
DECLARE existing_job RECORD;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-abandoned-public-incident-drafts' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.cleanup_abandoned_public_incident_drafts();

CREATE OR REPLACE FUNCTION public.verify_public_incident_cleanup_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT p_token IS NOT NULL AND p_token = (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_public_incident_cleanup_token' LIMIT 1
  )
$$;

CREATE OR REPLACE FUNCTION public.configure_public_incident_cleanup(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, net
AS $$
DECLARE generated_token TEXT; current_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/public-incident-cleanup$' THEN
    RAISE EXCEPTION 'Invalid public incident cleanup function URL';
  END IF;
  SELECT decrypted_secret INTO current_token FROM vault.decrypted_secrets WHERE name = 'softlife_public_incident_cleanup_token';
  IF current_token IS NULL THEN
    generated_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(generated_token, 'softlife_public_incident_cleanup_token', 'Authenticates public incident cleanup requests');
  END IF;
  PERFORM cron.schedule(
    'cleanup-abandoned-public-incident-drafts', '17 3 * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_public_incident_cleanup_token')),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $job$, p_function_url)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_public_incident_cleanup_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_public_incident_cleanup(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_public_incident_cleanup_token(TEXT) TO service_role;

SELECT public.configure_public_incident_cleanup('https://awsfqnymosevmhawbukf.supabase.co/functions/v1/public-incident-cleanup');
