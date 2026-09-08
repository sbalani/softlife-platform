ALTER TABLE public.mcp_api_keys DROP CONSTRAINT IF EXISTS mcp_api_keys_scopes_check;
ALTER TABLE public.mcp_api_keys ADD CONSTRAINT mcp_api_keys_scopes_check CHECK (
  cardinality(scopes) BETWEEN 1 AND 3
  AND scopes <@ ARRAY['read', 'forms', 'commands', 'sales_context', 'sales_notes']::TEXT[]
);

CREATE TABLE public.sales_context_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid UUID NOT NULL UNIQUE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT,
  machine_id UUID REFERENCES public.machines(id) ON DELETE RESTRICT,
  sales_date DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('event', 'promotion', 'operations', 'competition', 'other')),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  source_url TEXT CHECK (source_url IS NULL OR (char_length(source_url) <= 1000 AND source_url ~* '^https://')),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT
);

CREATE INDEX sales_context_notes_date_idx ON public.sales_context_notes(sales_date, machine_id, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX sales_context_notes_tenant_date_idx ON public.sales_context_notes(tenant_id, sales_date, id) WHERE deleted_at IS NULL;

ALTER TABLE public.sales_context_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_context_notes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sales_context_machine_tenant(p_machine_id UUID, p_sales_date DATE)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT assignment.tenant_id FROM public.machine_franchisee_assignments assignment
     WHERE assignment.machine_id = p_machine_id AND assignment.start_date <= p_sales_date
       AND (assignment.end_date IS NULL OR assignment.end_date >= p_sales_date)
     ORDER BY assignment.start_date DESC LIMIT 1),
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.machine_franchisee_assignments history WHERE history.machine_id = p_machine_id) THEN machine.tenant_id END
  )
  FROM public.machines machine WHERE machine.id = p_machine_id;
$$;

CREATE OR REPLACE FUNCTION public.read_sales_context_notes(
  p_actor_id UUID,
  p_from DATE,
  p_to DATE,
  p_machine_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  sales_date DATE,
  category TEXT,
  body TEXT,
  source_url TEXT,
  machine_id UUID,
  machine_name TEXT,
  author_name TEXT,
  can_delete BOOLEAN,
  revision INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE profiles.id = p_actor_id;
  IF NOT FOUND OR v_profile.role NOT IN ('admin', 'franchisee') THEN RAISE EXCEPTION 'Sales context access denied'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 365 THEN RAISE EXCEPTION 'Invalid sales context date range'; END IF;

  RETURN QUERY
  SELECT note.id, note.sales_date, note.category, note.body, note.source_url, note.machine_id,
    COALESCE(machine.display_name, machine.name), COALESCE(author.full_name, author.email, 'SoftLife user'),
    (v_profile.role = 'admin' OR note.created_by = p_actor_id), note.revision, note.created_at
  FROM public.sales_context_notes note
  LEFT JOIN public.machines machine ON machine.id = note.machine_id
  JOIN public.profiles author ON author.id = note.created_by
  WHERE note.deleted_at IS NULL
    AND note.sales_date BETWEEN p_from AND p_to
    AND (p_machine_id IS NULL OR note.machine_id IS NULL OR note.machine_id = p_machine_id)
    AND (
      v_profile.role = 'admin'
      OR (
        v_profile.tenant_id IS NOT NULL
        AND (
          (note.machine_id IS NULL AND note.tenant_id = v_profile.tenant_id)
          OR (
            note.machine_id IS NOT NULL
            AND public.sales_context_machine_tenant(note.machine_id, note.sales_date) = v_profile.tenant_id
          )
        )
      )
    )
  ORDER BY note.sales_date, note.created_at, note.id;
END;
$$;

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
  IF p_sales_date < DATE '2020-01-01' OR p_sales_date > (now() AT TIME ZONE 'Europe/Madrid')::DATE THEN RAISE EXCEPTION 'Invalid sales context date'; END IF;
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

CREATE OR REPLACE FUNCTION public.delete_sales_context_note(
  p_actor_id UUID,
  p_note_id UUID,
  p_expected_revision INTEGER,
  p_confirm BOOLEAN
)
RETURNS public.sales_context_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_note public.sales_context_notes%ROWTYPE;
  v_effective_tenant UUID;
BEGIN
  IF p_confirm IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Explicit confirmation is required'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE profiles.id = p_actor_id;
  IF NOT FOUND OR v_profile.role NOT IN ('admin', 'franchisee') THEN RAISE EXCEPTION 'Sales context access denied'; END IF;
  SELECT * INTO v_note FROM public.sales_context_notes WHERE id = p_note_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales context note not found'; END IF;
  IF v_note.machine_id IS NULL THEN
    v_effective_tenant := v_note.tenant_id;
  ELSE
    v_effective_tenant := public.sales_context_machine_tenant(v_note.machine_id, v_note.sales_date);
  END IF;
  IF v_profile.role <> 'admin' AND (v_note.created_by <> p_actor_id OR v_effective_tenant IS DISTINCT FROM v_profile.tenant_id) THEN
    RAISE EXCEPTION 'Sales context note not found';
  END IF;
  IF v_note.deleted_at IS NOT NULL AND v_note.revision = p_expected_revision + 1 THEN RETURN v_note; END IF;
  IF v_note.deleted_at IS NOT NULL OR v_note.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Sales context note revision conflict'; END IF;
  UPDATE public.sales_context_notes SET deleted_at = now(), deleted_by = p_actor_id, updated_at = now(), updated_by = p_actor_id, revision = revision + 1
  WHERE id = p_note_id RETURNING * INTO v_note;
  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_context_machine_tenant(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_sales_context_notes(UUID, DATE, DATE, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sales_context_note(UUID, UUID, DATE, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_sales_context_note(UUID, UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_context_machine_tenant(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_context_notes(UUID, DATE, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_sales_context_note(UUID, UUID, DATE, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_sales_context_note(UUID, UUID, INTEGER, BOOLEAN) TO service_role;
