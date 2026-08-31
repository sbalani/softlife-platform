CREATE OR REPLACE FUNCTION public.release_huaxin_machine_write(p_machine_id UUID, p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.huaxin_machine_refresh_state
  SET owner_token = NULL, lease_until = '-infinity', updated_at = now()
  WHERE machine_id = p_machine_id AND owner_token = p_owner;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.release_huaxin_machine_write(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_huaxin_machine_write(UUID, UUID) TO service_role;
