CREATE OR REPLACE FUNCTION public.cleanup_direct_machine_payloads()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count BIGINT;
BEGIN
  DELETE FROM public.direct_machine_payloads
  WHERE received_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_direct_machine_payloads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_direct_machine_payloads() TO service_role;

DO $$
DECLARE existing_job RECORD;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-direct-machine-payloads' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'cleanup-direct-machine-payloads',
    '23 3 * * *',
    'SELECT public.cleanup_direct_machine_payloads()'
  );
END;
$$;
