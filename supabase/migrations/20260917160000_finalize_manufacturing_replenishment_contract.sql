CREATE OR REPLACE FUNCTION public.get_manufacturing_stock_snapshot(
  p_source_warehouse_id INTEGER, p_warehouse_ids INTEGER[], p_product_ids INTEGER[]
)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'observed_at', (SELECT last_synced_at FROM public.odoo_mirror_state WHERE key = 'warehouse_product_stock'),
    'product_stock', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'odoo_warehouse_id', stock.odoo_warehouse_id,
        'odoo_product_id', stock.odoo_product_id,
        'available_quantity', stock.available_quantity
      ) ORDER BY stock.odoo_warehouse_id, stock.odoo_product_id)
      FROM public.odoo_warehouse_product_stock stock
      WHERE stock.odoo_warehouse_id = ANY(p_warehouse_ids) AND stock.odoo_product_id = ANY(p_product_ids)
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'odoo_id', product.odoo_id, 'name', product.name, 'uom', product.uom,
        'uom_rounding', product.uom_rounding, 'tracking', product.tracking,
        'package_content_quantity', product.package_content_quantity,
        'package_content_uom', product.package_content_uom
      ) ORDER BY product.odoo_id)
      FROM public.odoo_products product WHERE product.odoo_id = ANY(p_product_ids)
    ), '[]'::jsonb),
    'lot_stock', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'odoo_warehouse_id', stock.odoo_warehouse_id, 'odoo_lot_id', stock.odoo_lot_id,
        'available_qty', stock.available_qty, 'lot_name', lot.name,
        'expiration_date', lot.expiration_date, 'odoo_product_id', lot.odoo_product_id
      ) ORDER BY lot.odoo_product_id, lot.expiration_date NULLS LAST, lot.name, stock.odoo_lot_id)
      FROM public.odoo_lot_stock stock
      JOIN public.odoo_lots lot ON lot.odoo_id = stock.odoo_lot_id
      WHERE stock.odoo_warehouse_id = p_source_warehouse_id AND stock.available_qty > 0
        AND lot.odoo_product_id = ANY(p_product_ids)
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.record_manufacturing_replenishment_result(
  p_export_id UUID, p_payload_sha256 TEXT, p_result JSONB
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_accepted BOOLEAN; v_expected_count INTEGER; v_received_count INTEGER;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND OR v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION 'Replenishment result does not match the frozen run' USING ERRCODE = 'P0002';
  END IF;
  IF v_export.replenishment_result = p_result THEN RETURN v_export; END IF;
  IF v_export.status NOT IN ('replenishment_ready', 'replenishment_failed') THEN RAISE EXCEPTION 'Run is not awaiting a replenishment result' USING ERRCODE = 'P0001'; END IF;
  v_accepted := COALESCE((p_result->>'accepted')::BOOLEAN, false);
  IF v_accepted THEN
    v_expected_count := jsonb_array_length(COALESCE(v_export.payload->'replenishment'->'transfers', '[]'::jsonb));
    IF jsonb_typeof(p_result->'transfers') <> 'array' OR jsonb_typeof(p_result->'picking_ids') <> 'array' THEN
      RAISE EXCEPTION 'Accepted replenishment requires transfer and picking results';
    END IF;
    SELECT count(DISTINCT item->>'transfer_key') INTO v_received_count FROM jsonb_array_elements(p_result->'transfers') item;
    IF v_expected_count = 0 OR jsonb_array_length(p_result->'transfers') <> v_expected_count
      OR jsonb_array_length(p_result->'picking_ids') <> v_expected_count OR v_received_count <> v_expected_count
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_export.payload->'replenishment'->'transfers') expected
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_result->'transfers') received
          WHERE received->>'transfer_key' = expected->>'transfer_key'
        )
      ) THEN RAISE EXCEPTION 'Accepted replenishment result does not cover every frozen transfer'; END IF;
  END IF;
  UPDATE public.manufacturing_period_exports SET
    status = CASE WHEN v_accepted THEN 'draft' ELSE 'replenishment_failed' END,
    replenishment_result = p_result,
    replenishment_completed_at = CASE WHEN v_accepted THEN now() ELSE NULL END
  WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

REVOKE ALL ON FUNCTION public.get_manufacturing_stock_snapshot(INTEGER, INTEGER[], INTEGER[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_manufacturing_stock_snapshot(INTEGER, INTEGER[], INTEGER[]) TO service_role;
