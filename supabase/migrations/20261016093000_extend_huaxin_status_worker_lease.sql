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
  SET status = 'failed', finished_at = now(), error = 'Status worker did not finish within fifteen minutes'
  WHERE status = 'running' AND started_at < now() - INTERVAL '15 minutes';
  IF EXISTS (SELECT 1 FROM public.huaxin_status_shadow_runs WHERE status = 'running') THEN RETURN NULL; END IF;
  INSERT INTO public.huaxin_status_shadow_runs(trigger_source) VALUES (p_trigger_source) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$$;
