CREATE OR REPLACE FUNCTION public.create_coupon_request(
  p_tenant_id UUID,
  p_requested_by UUID,
  p_coupon_type TEXT,
  p_coupon_name TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_valid_day INTEGER,
  p_total_count INTEGER,
  p_uses_per_code INTEGER,
  p_local_name TEXT,
  p_money NUMERIC,
  p_amount INTEGER,
  p_product_position TEXT,
  p_product_name TEXT,
  p_machine_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_today DATE := (now() AT TIME ZONE 'Europe/Madrid')::DATE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_requested_by AND tenant_id = p_tenant_id AND role = 'franchisee'
  ) THEN
    RAISE EXCEPTION 'Invalid franchisee account';
  END IF;
  IF cardinality(COALESCE(p_machine_ids, ARRAY[]::UUID[])) = 0 THEN
    RAISE EXCEPTION 'Select at least one machine';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_machine_ids) AS selected(machine_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.machine_franchisee_assignments assignment
      WHERE assignment.machine_id = selected.machine_id
        AND assignment.tenant_id = p_tenant_id
        AND assignment.start_date <= v_today
        AND (assignment.end_date IS NULL OR assignment.end_date >= v_today)
    )
  ) THEN
    RAISE EXCEPTION 'One or more selected machines are no longer assigned to this franchise';
  END IF;

  INSERT INTO public.coupon_requests (
    tenant_id, requested_by, coupon_type, coupon_name, start_date, end_date,
    valid_day, total_count, uses_per_code, local_name, money, amount,
    product_position, product_name
  ) VALUES (
    p_tenant_id, p_requested_by, p_coupon_type, p_coupon_name, p_start_date, p_end_date,
    p_valid_day, p_total_count, p_uses_per_code, p_local_name, p_money, p_amount,
    p_product_position, p_product_name
  ) RETURNING id INTO v_request_id;

  INSERT INTO public.coupon_request_machines (request_id, machine_id)
  SELECT v_request_id, machine_id FROM unnest(p_machine_ids) AS selected(machine_id)
  GROUP BY machine_id;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_coupon_request(UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, INTEGER, TEXT, NUMERIC, INTEGER, TEXT, TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_coupon_request(UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, INTEGER, TEXT, NUMERIC, INTEGER, TEXT, TEXT, UUID[]) TO service_role;
