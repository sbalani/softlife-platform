ALTER TABLE public.odoo_sync_requests ADD COLUMN claim_token UUID;

DROP FUNCTION public.complete_odoo_sync_request(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.claim_odoo_sync_request()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.odoo_sync_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM public.odoo_sync_requests
  WHERE status = 'pending' OR (status = 'processing' AND claimed_at < now() - interval '15 minutes')
  ORDER BY requested_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.odoo_sync_requests SET status = 'processing', claimed_at = now(), claim_token = gen_random_uuid(),
    completed_at = NULL, attempts = attempts + 1, result = NULL, error = NULL
  WHERE id = v_request.id RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END; $$;

CREATE OR REPLACE FUNCTION public.complete_odoo_sync_request(p_request_id UUID, p_claim_token UUID, p_result JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.odoo_sync_requests%ROWTYPE; v_accepted BOOLEAN;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR jsonb_typeof(p_result->'accepted') <> 'boolean' THEN
    RAISE EXCEPTION 'A structured sync result is required';
  END IF;
  SELECT * INTO v_request FROM public.odoo_sync_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Odoo sync request not found'; END IF;
  IF v_request.status IN ('completed', 'failed') AND v_request.claim_token = p_claim_token AND v_request.result = p_result THEN RETURN to_jsonb(v_request); END IF;
  IF v_request.status <> 'processing' OR v_request.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'Odoo sync request lease is stale' USING ERRCODE = 'P0001';
  END IF;
  v_accepted := (p_result->>'accepted')::BOOLEAN;
  UPDATE public.odoo_sync_requests SET status = CASE WHEN v_accepted THEN 'completed' ELSE 'failed' END,
    completed_at = now(), result = p_result,
    error = CASE WHEN v_accepted THEN NULL ELSE left(COALESCE(p_result->>'error', 'Odoo sync failed'), 5000) END
  WHERE id = p_request_id RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END; $$;

CREATE OR REPLACE FUNCTION public.get_odoo_stock_snapshot_diagnostics()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'warehouse_product_observed_at', (SELECT last_synced_at FROM public.odoo_mirror_state WHERE key = 'warehouse_product_stock'),
    'lot_stock_observed_at', (SELECT last_synced_at FROM public.odoo_mirror_state WHERE key = 'lot_stock'),
    'warehouse_product_rows', (SELECT count(*) FROM public.odoo_warehouse_product_stock),
    'lot_stock_rows', (SELECT count(*) FROM public.odoo_lot_stock WHERE available_qty > 0),
    'products', (SELECT count(*) FROM public.odoo_products),
    'tracked_products', (SELECT count(*) FROM public.odoo_products WHERE tracking <> 'none'),
    'warehouses', (SELECT count(*) FROM public.odoo_warehouses),
    'warehouse_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'odoo_warehouse_id', warehouse.odoo_id, 'name', warehouse.name,
        'stock_location_id', warehouse.stock_location_id,
        'product_rows', (SELECT count(*) FROM public.odoo_warehouse_product_stock stock WHERE stock.odoo_warehouse_id = warehouse.odoo_id),
        'lot_rows', (SELECT count(*) FROM public.odoo_lot_stock stock WHERE stock.odoo_warehouse_id = warehouse.odoo_id AND stock.available_qty > 0)
      ) ORDER BY warehouse.name)
      FROM public.odoo_warehouses warehouse
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.complete_odoo_sync_request(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_odoo_sync_request(UUID, UUID, JSONB) TO service_role;
