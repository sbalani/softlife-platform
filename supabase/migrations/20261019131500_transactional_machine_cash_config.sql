CREATE OR REPLACE FUNCTION public.save_machine_configuration(
  p_machine_id UUID,
  p_actor_id UUID,
  p_profile TEXT,
  p_display_name TEXT,
  p_nayax_id TEXT,
  p_payment_model TEXT,
  p_location_override TEXT,
  p_odoo_warehouse_id INTEGER,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_geocoded_from TEXT,
  p_deployed BOOLEAN,
  p_defrost_enabled BOOLEAN,
  p_defrost_time TIME,
  p_defrost_seconds INTEGER,
  p_apply_cash_config BOOLEAN,
  p_cash_enabled BOOLEAN,
  p_cash_effective_at TIMESTAMPTZ,
  p_cash_balance_cents BIGINT,
  p_cash_final_count_cents BIGINT,
  p_cash_final_withdrawal_cents BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_machine public.machines%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_payment_model NOT IN ('automatic', 'server', 'hybrid') THEN RAISE EXCEPTION 'Invalid payment model'; END IF;
  UPDATE public.machines SET
    profile = NULLIF(btrim(p_profile), ''),
    display_name = NULLIF(btrim(p_display_name), ''),
    nayax_id = NULLIF(btrim(p_nayax_id), ''),
    payment_model = p_payment_model,
    location_override = NULLIF(btrim(p_location_override), ''),
    odoo_warehouse_id = p_odoo_warehouse_id,
    latitude = p_latitude,
    longitude = p_longitude,
    geocoded_from = p_geocoded_from
  WHERE id = p_machine_id
  RETURNING * INTO v_machine;
  IF v_machine.id IS NULL THEN RAISE EXCEPTION 'Machine not found'; END IF;

  PERFORM public.set_machine_operations(
    p_machine_id, p_deployed, p_defrost_enabled, p_defrost_time,
    p_defrost_seconds, p_actor_id
  );
  IF p_apply_cash_config THEN
    PERFORM public.configure_machine_cashbox(
      p_machine_id, p_cash_enabled, p_actor_id, p_cash_effective_at,
      p_cash_balance_cents, p_cash_final_count_cents, p_cash_final_withdrawal_cents
    );
  END IF;
  RETURN jsonb_build_object('id', v_machine.id, 'last_full_clean_date', v_machine.last_full_clean_date);
END;
$$;

REVOKE ALL ON FUNCTION public.save_machine_configuration(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DOUBLE PRECISION,
  DOUBLE PRECISION, TEXT, BOOLEAN, BOOLEAN, TIME, INTEGER, BOOLEAN, BOOLEAN,
  TIMESTAMPTZ, BIGINT, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_machine_configuration(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DOUBLE PRECISION,
  DOUBLE PRECISION, TEXT, BOOLEAN, BOOLEAN, TIME, INTEGER, BOOLEAN, BOOLEAN,
  TIMESTAMPTZ, BIGINT, BIGINT, BIGINT
) TO service_role;
