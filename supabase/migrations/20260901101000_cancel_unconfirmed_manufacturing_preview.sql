CREATE OR REPLACE FUNCTION public.claim_manufacturing_export_preparation(
  p_export_id UUID,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS public.manufacturing_period_exports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.status NOT IN ('preparing', 'blocked', 'failed') OR v_export.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Manufacturing export preparation changed' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.manufacturing_period_exports SET status = 'preparing'
    WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_manufacturing_export(
  p_export_id UUID,
  p_payload_sha256 TEXT,
  p_caller TEXT
)
RETURNS public.manufacturing_period_exports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.initiated_by <> p_caller THEN RAISE EXCEPTION 'Only the initiating system can confirm this run' USING ERRCODE = 'P0005'; END IF;
  IF v_export.status = 'ready' AND v_export.payload_sha256 = p_payload_sha256 THEN RETURN v_export; END IF;
  IF v_export.status <> 'draft' THEN RAISE EXCEPTION 'Only an unblocked draft can be confirmed' USING ERRCODE = 'P0001'; END IF;
  IF v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'Preview payload hash is stale' USING ERRCODE = 'P0002'; END IF;

  PERFORM 1
  FROM public.huaxin_orders order_row
  JOIN public.manufacturing_period_export_orders membership ON membership.order_id = order_row.id
  WHERE membership.export_id = p_export_id
  ORDER BY order_row.id
  FOR UPDATE OF order_row;
  IF EXISTS (
    SELECT 1 FROM public.manufacturing_period_export_orders membership
    JOIN public.huaxin_orders order_row ON order_row.id = membership.order_id
    WHERE membership.export_id = p_export_id
      AND (membership.export_version <> order_row.export_version OR membership.export_content_hash IS DISTINCT FROM order_row.export_content_hash)
  ) THEN RAISE EXCEPTION 'An order changed after preview; prepare the run again' USING ERRCODE = 'P0003'; END IF;

  UPDATE public.manufacturing_period_exports SET status = 'ready', confirmed_at = now()
    WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_unconfirmed_manufacturing_export(
  p_export_id UUID,
  p_caller TEXT
)
RETURNS public.manufacturing_period_exports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_export public.manufacturing_period_exports%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.initiated_by <> p_caller THEN
    RAISE EXCEPTION 'Only the initiating system can cancel this preview' USING ERRCODE = 'P0005';
  END IF;
  IF v_export.status = 'cancelled' THEN RETURN v_export; END IF;
  IF v_export.confirmed_at IS NOT NULL OR v_export.status NOT IN ('draft', 'blocked') THEN
    RAISE EXCEPTION 'Only an unconfirmed draft or blocked preview can be cancelled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.manufacturing_period_export_orders
    SET released_at = v_now
    WHERE export_id = p_export_id AND released_at IS NULL;
  UPDATE public.manufacturing_period_exports
    SET status = 'cancelled'
    WHERE id = p_export_id
    RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_unconfirmed_manufacturing_export(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_manufacturing_export(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_manufacturing_export_preparation(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unconfirmed_manufacturing_export(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_manufacturing_export(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_manufacturing_export_preparation(UUID, TIMESTAMPTZ) TO service_role;
