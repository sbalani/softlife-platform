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
         latest.status,
         latest.start_time,
         latest.end_time,
         latest.return_message
  FROM cron.job AS job
  LEFT JOIN LATERAL (
    SELECT detail.status, detail.start_time, detail.end_time, detail.return_message
    FROM cron.job_run_details AS detail
    WHERE detail.jobid = job.jobid
    ORDER BY detail.start_time DESC
    LIMIT 1
  ) AS latest ON true
  WHERE job.jobname = 'softlife-huaxin-status-shadow-every-30-minutes';
$$;

REVOKE ALL ON FUNCTION public.get_huaxin_status_shadow_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_huaxin_status_shadow_schedule() TO service_role;
