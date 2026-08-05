CREATE TABLE IF NOT EXISTS public.huaxin_sync_lock (
  key TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity'
);

INSERT INTO public.huaxin_sync_lock (key) VALUES ('fleet') ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.huaxin_sync_lock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.huaxin_sync_lock FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_huaxin_sync_lock()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.huaxin_sync_lock
  SET locked_until = now() + INTERVAL '10 minutes'
  WHERE key = 'fleet' AND locked_until < now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_huaxin_sync_lock()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.huaxin_sync_lock SET locked_until = '-infinity' WHERE key = 'fleet';
$$;

REVOKE ALL ON FUNCTION public.claim_huaxin_sync_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_huaxin_sync_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_huaxin_sync_lock(), public.release_huaxin_sync_lock() TO service_role;
