DROP FUNCTION public.configure_defrost_cron(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.verify_defrost_cron_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT length(COALESCE(p_token, '')) >= 32
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'softlife_defrost_cron_token'
        AND decrypted_secret = p_token
    );
$$;

CREATE OR REPLACE FUNCTION public.configure_defrost_cron(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, net
AS $$
DECLARE
  existing_job RECORD;
  generated_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/defrost$' THEN
    RAISE EXCEPTION 'Invalid defrost function URL';
  END IF;

  generated_token := encode(extensions.gen_random_bytes(32), 'hex');
  DELETE FROM vault.secrets WHERE name = 'softlife_defrost_cron_token';
  PERFORM vault.create_secret(generated_token, 'softlife_defrost_cron_token', 'Authenticates the pg_cron defrost Edge Function request');

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
            'x-cron-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_defrost_cron_token')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 50000
        )
        WHERE EXISTS (
          SELECT 1
          FROM public.machine_defrost_runs run
          WHERE run.state IN ('scheduled', 'thawing', 'thaw_closed', 'forming', 'recovery')
            AND run.next_action_at <= now()
            AND (run.lease_until IS NULL OR run.lease_until < now())
          UNION ALL
          SELECT 1
          FROM public.machine_defrost_schedules schedule
          JOIN public.machines machine ON machine.id = schedule.machine_id
          CROSS JOIN LATERAL (
            SELECT (((now() AT TIME ZONE schedule.time_zone)::DATE + schedule.local_start_time) AT TIME ZONE schedule.time_zone) AS scheduled_for
          ) local_time
          WHERE schedule.enabled
            AND NOT schedule.requires_intervention
            AND machine.deployed
            AND local_time.scheduled_for <= now()
            AND local_time.scheduled_for > now() - INTERVAL '10 minutes'
        );
      $job$,
      p_function_url
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_defrost_cron_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_defrost_cron(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_defrost_cron_token(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.configure_defrost_cron(TEXT) TO service_role;
