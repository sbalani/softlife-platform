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
  IF NOT EXISTS (
    SELECT 1 FROM public.manufacturing_period_export_orders
    WHERE export_id = p_export_id AND released_at IS NULL
  ) THEN RAISE EXCEPTION 'An empty manufacturing run cannot be confirmed' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1
  FROM public.huaxin_orders order_row
  JOIN public.manufacturing_period_export_orders membership ON membership.order_id = order_row.id
  WHERE membership.export_id = p_export_id AND membership.released_at IS NULL
  ORDER BY order_row.id
  FOR UPDATE OF order_row;
  IF EXISTS (
    SELECT 1 FROM public.manufacturing_period_export_orders membership
    JOIN public.huaxin_orders order_row ON order_row.id = membership.order_id
    WHERE membership.export_id = p_export_id AND membership.released_at IS NULL
      AND (membership.export_version <> order_row.export_version OR membership.export_content_hash IS DISTINCT FROM order_row.export_content_hash)
  ) THEN RAISE EXCEPTION 'An order changed after preview; prepare the run again' USING ERRCODE = 'P0003'; END IF;

  UPDATE public.manufacturing_period_exports SET status = 'ready', confirmed_at = now()
    WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_manufacturing_export(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_manufacturing_export(UUID, TEXT, TEXT) TO service_role;
