CREATE TABLE public.huaxin_machine_refresh_state (
  machine_id UUID PRIMARY KEY REFERENCES public.machines(id) ON DELETE CASCADE,
  owner_token UUID,
  lease_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  cooldown_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  last_attempt_at TIMESTAMPTZ,
  last_succeeded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.huaxin_machine_refresh_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_huaxin_machine_refresh(p_machine_id UUID, p_owner UUID)
RETURNS TABLE(claimed BOOLEAN, reason TEXT, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.huaxin_machine_refresh_state%ROWTYPE;
  v_fleet_until TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(8462947001);
  IF NOT EXISTS (SELECT 1 FROM public.machines WHERE id = p_machine_id) THEN RAISE EXCEPTION 'Machine not found'; END IF;
  INSERT INTO public.huaxin_machine_refresh_state (machine_id) VALUES (p_machine_id) ON CONFLICT DO NOTHING;
  SELECT * INTO v_state FROM public.huaxin_machine_refresh_state WHERE machine_id = p_machine_id FOR UPDATE;
  SELECT locked_until INTO v_fleet_until FROM public.huaxin_sync_lock WHERE key = 'fleet';
  IF v_fleet_until >= now() THEN
    RETURN QUERY SELECT false, 'fleet_sync'::TEXT, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_fleet_until - now())))::INTEGER);
    RETURN;
  END IF;
  IF v_state.lease_until >= now() THEN
    RETURN QUERY SELECT false, 'in_progress'::TEXT, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_state.lease_until - now())))::INTEGER);
    RETURN;
  END IF;
  IF v_state.cooldown_until >= now() THEN
    RETURN QUERY SELECT false, 'cooldown'::TEXT, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_state.cooldown_until - now())))::INTEGER);
    RETURN;
  END IF;
  UPDATE public.huaxin_machine_refresh_state
  SET owner_token = p_owner, lease_until = now() + INTERVAL '2 minutes', last_attempt_at = now(), updated_at = now()
  WHERE machine_id = p_machine_id;
  RETURN QUERY SELECT true, 'claimed'::TEXT, 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_huaxin_machine_refresh(p_machine_id UUID, p_owner UUID, p_succeeded BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.huaxin_machine_refresh_state
  SET owner_token = NULL,
      lease_until = '-infinity',
      cooldown_until = now() + CASE WHEN p_succeeded THEN INTERVAL '60 seconds' ELSE INTERVAL '15 seconds' END,
      last_succeeded_at = CASE WHEN p_succeeded THEN now() ELSE last_succeeded_at END,
      updated_at = now()
  WHERE machine_id = p_machine_id AND owner_token = p_owner;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_huaxin_machine_refresh(p_machine_id UUID, p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.huaxin_machine_refresh_state
  SET lease_until = now() + INTERVAL '2 minutes', updated_at = now()
  WHERE machine_id = p_machine_id AND owner_token = p_owner AND lease_until >= now();
  RETURN FOUND;
END;
$$;

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
  SET locked_until = now() + INTERVAL '10 minutes', owner_token = p_owner
  WHERE key = 'fleet' AND locked_until < now();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON TABLE public.huaxin_machine_refresh_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_huaxin_machine_refresh(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_huaxin_machine_refresh(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_huaxin_machine_refresh(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_huaxin_machine_refresh(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_huaxin_machine_refresh(UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_huaxin_machine_refresh(UUID, UUID) TO service_role;
