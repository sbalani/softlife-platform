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
        AND EXISTS (
          SELECT 1
          FROM public.machine_franchisee_assignments assignment
          WHERE assignment.machine_id = orders.machine_id
            AND assignment.tenant_id = profile.tenant_id
            AND assignment.start_date <= (orders.order_time AT TIME ZONE 'Europe/Madrid')::DATE
            AND (assignment.end_date IS NULL OR assignment.end_date >= (orders.order_time AT TIME ZONE 'Europe/Madrid')::DATE)
        )
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
