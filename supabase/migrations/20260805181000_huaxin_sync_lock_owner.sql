ALTER TABLE public.huaxin_sync_lock ADD COLUMN IF NOT EXISTS owner_token UUID;

DROP FUNCTION IF EXISTS public.claim_huaxin_sync_lock();
DROP FUNCTION IF EXISTS public.release_huaxin_sync_lock();

CREATE FUNCTION public.claim_huaxin_sync_lock(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.huaxin_sync_lock
  SET locked_until = now() + INTERVAL '10 minutes', owner_token = p_owner
  WHERE key = 'fleet' AND locked_until < now();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.release_huaxin_sync_lock(p_owner UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.huaxin_sync_lock
  SET locked_until = '-infinity', owner_token = NULL
  WHERE key = 'fleet' AND owner_token = p_owner;
$$;

REVOKE ALL ON FUNCTION public.claim_huaxin_sync_lock(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_huaxin_sync_lock(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_huaxin_sync_lock(UUID), public.release_huaxin_sync_lock(UUID) TO service_role;
