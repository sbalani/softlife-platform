CREATE OR REPLACE FUNCTION public.get_huaxin_status_shadow_schedule()
RETURNS TABLE (
  job_id BIGINT,
  schedule TEXT,
  active BOOLEAN,
  last_status TEXT,
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_message TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron
AS $$
  SELECT job.jobid,
         job.schedule,
         job.active,
         NULL::TEXT,
         NULL::TIMESTAMPTZ,
         NULL::TIMESTAMPTZ,
         NULL::TEXT
  FROM cron.job AS job
  WHERE job.jobname = 'softlife-huaxin-status-shadow-every-30-minutes';
$$;
