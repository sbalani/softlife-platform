CREATE OR REPLACE FUNCTION public.create_sales_context_note(
  p_actor_id UUID,
  p_client_uuid UUID,
  p_sales_date DATE,
  p_category TEXT,
  p_body TEXT,
  p_source_url TEXT DEFAULT NULL,
  p_machine_id UUID DEFAULT NULL
)
RETURNS public.sales_context_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_existing public.sales_context_notes%ROWTYPE;
  v_machine public.machines%ROWTYPE;
  v_tenant_id UUID;
  v_body TEXT := btrim(COALESCE(p_body, ''));
  v_source_url TEXT := NULLIF(btrim(p_source_url), '');
  v_result public.sales_context_notes%ROWTYPE;
BEGIN
  IF p_client_uuid IS NULL THEN RAISE EXCEPTION 'A client UUID is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));
  SELECT * INTO v_profile FROM public.profiles WHERE profiles.id = p_actor_id;
  IF NOT FOUND OR v_profile.role NOT IN ('admin', 'franchisee') THEN RAISE EXCEPTION 'Sales context access denied'; END IF;
  -- The extra day accommodates users whose configured calendar is ahead of Madrid.
  IF p_sales_date < DATE '2020-01-01' OR p_sales_date > (now() AT TIME ZONE 'Europe/Madrid')::DATE + 731 THEN RAISE EXCEPTION 'Invalid sales context date'; END IF;
  IF p_category NOT IN ('event', 'promotion', 'operations', 'competition', 'other') THEN RAISE EXCEPTION 'Invalid sales context category'; END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Sales context note must contain 1 to 2000 characters'; END IF;
  IF v_source_url IS NOT NULL AND (char_length(v_source_url) > 1000 OR v_source_url !~* '^https://') THEN RAISE EXCEPTION 'Source URL must use HTTPS'; END IF;

  SELECT * INTO v_existing FROM public.sales_context_notes WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    IF v_existing.created_by IS DISTINCT FROM p_actor_id OR v_existing.sales_date IS DISTINCT FROM p_sales_date
      OR v_existing.machine_id IS DISTINCT FROM p_machine_id OR v_existing.category IS DISTINCT FROM p_category
      OR v_existing.body IS DISTINCT FROM v_body OR v_existing.source_url IS DISTINCT FROM v_source_url THEN
      RAISE EXCEPTION 'Sales context idempotency key conflicts with another note';
    END IF;
    RETURN v_existing;
  END IF;

  IF p_machine_id IS NOT NULL THEN
    SELECT * INTO v_machine FROM public.machines WHERE machines.id = p_machine_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
    v_tenant_id := public.sales_context_machine_tenant(p_machine_id, p_sales_date);
    IF v_profile.role = 'franchisee' AND (v_profile.tenant_id IS NULL OR v_profile.tenant_id IS DISTINCT FROM v_tenant_id) THEN
      RAISE EXCEPTION 'Machine not found';
    END IF;
  ELSE
    v_tenant_id := CASE WHEN v_profile.role = 'franchisee' THEN v_profile.tenant_id ELSE NULL END;
    IF v_profile.role = 'franchisee' AND v_tenant_id IS NULL THEN RAISE EXCEPTION 'Sales context access denied'; END IF;
  END IF;

  INSERT INTO public.sales_context_notes(client_uuid, tenant_id, machine_id, sales_date, category, body, source_url, created_by, updated_by)
  VALUES (p_client_uuid, v_tenant_id, p_machine_id, p_sales_date, p_category, v_body, v_source_url, p_actor_id, p_actor_id)
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sales_context_note(UUID, UUID, DATE, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_context_note(UUID, UUID, DATE, TEXT, TEXT, TEXT, UUID) TO service_role;
