CREATE OR REPLACE FUNCTION public.claim_huaxin_sync_lock(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(8462947001);
  IF EXISTS (SELECT 1 FROM public.huaxin_machine_refresh_state WHERE lease_until >= now()) THEN RETURN false; END IF;
  UPDATE public.huaxin_sync_lock
  SET locked_until = now() + INTERVAL '2 minutes', owner_token = p_owner
  WHERE key = 'fleet' AND locked_until < now();
  RETURN FOUND;
END;
$$;

UPDATE public.huaxin_sync_lock
SET locked_until = LEAST(locked_until, now() + INTERVAL '2 minutes')
WHERE key = 'fleet' AND locked_until >= now();

REVOKE ALL ON FUNCTION public.claim_huaxin_sync_lock(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_huaxin_sync_lock(UUID) TO service_role;
