DELETE FROM public.mcp_api_keys WHERE profile_id IS NULL;

ALTER TABLE public.mcp_api_keys
  ADD COLUMN scopes TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[],
  ADD COLUMN expires_at TIMESTAMPTZ,
  ALTER COLUMN profile_id SET NOT NULL,
  ADD CONSTRAINT mcp_api_keys_scopes_check CHECK (
    cardinality(scopes) BETWEEN 1 AND 3
    AND scopes <@ ARRAY['read', 'forms', 'commands']::TEXT[]
  );

DROP POLICY IF EXISTS "Users can manage own keys" ON public.mcp_api_keys;
REVOKE ALL ON public.mcp_api_keys FROM anon, authenticated;

CREATE TABLE public.mcp_command_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID NOT NULL REFERENCES public.mcp_api_keys(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  command TEXT NOT NULL CHECK (command IN ('operate_sellout', 'operate_make')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'accepted', 'rejected', 'ambiguous')),
  provider_serial TEXT,
  huaxin_code TEXT,
  huaxin_message TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (key_id, idempotency_key)
);

CREATE INDEX mcp_command_requests_machine_created_idx
  ON public.mcp_command_requests(machine_id, created_at DESC);

ALTER TABLE public.mcp_command_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_command_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_authorized_orders(
  p_profile_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_machine_id UUID DEFAULT NULL,
  p_before_time TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 1000
)
RETURNS SETOF public.v_orders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT orders.*
  FROM public.v_orders orders
  JOIN public.profiles profile ON profile.id = p_profile_id
  JOIN public.machines machine ON machine.id = orders.machine_id
  WHERE orders.order_time >= p_from
    AND orders.order_time < p_to
    AND (p_machine_id IS NULL OR orders.machine_id = p_machine_id)
    AND (p_before_time IS NULL OR (orders.order_time, orders.id) < (p_before_time, p_before_id))
    AND (
      profile.role = 'admin'
      OR (
        profile.role = 'franchisee'
        AND profile.tenant_id IS NOT NULL
        AND orders.tenant_id = profile.tenant_id
        AND machine.deployed
        AND (
          SELECT assignment.tenant_id
          FROM public.machine_franchisee_assignments assignment
          WHERE assignment.machine_id = orders.machine_id
            AND assignment.start_date <= (now() AT TIME ZONE 'Europe/Madrid')::DATE
            AND (assignment.end_date IS NULL OR assignment.end_date >= (now() AT TIME ZONE 'Europe/Madrid')::DATE)
          ORDER BY assignment.start_date DESC
          LIMIT 1
        ) = profile.tenant_id
      )
      OR (
        profile.role = 'operator'
        AND machine.deployed
        AND EXISTS (
          SELECT 1 FROM public.user_machine_assignments current_assignment
          WHERE current_assignment.user_id = profile.id
            AND current_assignment.machine_id = orders.machine_id
            AND current_assignment.starts_at <= now()
            AND (current_assignment.ends_at IS NULL OR current_assignment.ends_at >= now())
        )
        AND EXISTS (
          SELECT 1 FROM public.user_machine_assignments event_assignment
          WHERE event_assignment.user_id = profile.id
            AND event_assignment.machine_id = orders.machine_id
            AND event_assignment.starts_at <= orders.order_time
            AND (event_assignment.ends_at IS NULL OR event_assignment.ends_at >= orders.order_time)
        )
      )
    )
  ORDER BY orders.order_time DESC, orders.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.mcp_authorized_orders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_authorized_orders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TIMESTAMPTZ, UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.record_mcp_command_outcome(
  p_request_id UUID,
  p_state TEXT,
  p_huaxin_code TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL,
  p_error_detail TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row public.mcp_command_requests%ROWTYPE;
  machine_row public.machines%ROWTYPE;
BEGIN
  IF p_state NOT IN ('accepted', 'rejected', 'ambiguous') THEN
    RAISE EXCEPTION 'Invalid MCP command outcome';
  END IF;

  SELECT * INTO request_row FROM public.mcp_command_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP command request not found'; END IF;
  IF request_row.state IN ('accepted', 'rejected', 'ambiguous') THEN RETURN; END IF;
  IF (request_row.state = 'pending' AND p_state <> 'rejected')
    OR (request_row.state = 'sending' AND p_state NOT IN ('accepted', 'rejected', 'ambiguous')) THEN
    RAISE EXCEPTION 'Invalid MCP command state transition';
  END IF;

  SELECT * INTO machine_row FROM public.machines WHERE id = request_row.machine_id;
  UPDATE public.mcp_command_requests SET
    state = p_state,
    huaxin_code = p_huaxin_code,
    huaxin_message = p_message,
    error_detail = p_error_detail,
    completed_at = now()
  WHERE id = request_row.id;

  INSERT INTO public.machine_change_log (
    machine_id, device_imei, machine_name, source, action, entity_type, entity_key,
    field, new_value, actor_id, metadata
  ) VALUES (
    request_row.machine_id, machine_row.device_imei, COALESCE(machine_row.display_name, machine_row.name),
    'platform', CASE WHEN p_state = 'accepted' THEN 'remote_command' ELSE 'remote_command_failed' END,
    'machine', request_row.machine_id::TEXT, request_row.command, NULLIF(p_details, '{}'::JSONB),
    request_row.actor_id,
    jsonb_build_object(
      'source', 'mcp', 'channel', 'mcp', 'key_id', request_row.key_id,
      'idempotency_key', request_row.idempotency_key, 'outcome', p_state
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_mcp_command_outcome(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mcp_command_outcome(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
