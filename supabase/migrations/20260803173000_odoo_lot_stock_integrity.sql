DROP POLICY IF EXISTS odoo_lot_stock_read ON public.odoo_lot_stock;

CREATE TABLE IF NOT EXISTS public.odoo_mirror_state (
  key TEXT PRIMARY KEY,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.odoo_mirror_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.replace_odoo_lot_stock(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 100000 THEN
    RAISE EXCEPTION 'Invalid Odoo lot stock snapshot';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('replace_odoo_lot_stock'));
  DELETE FROM public.odoo_lot_stock;
  INSERT INTO public.odoo_lot_stock (odoo_lot_id, odoo_warehouse_id, qty, updated_at)
  SELECT
    (row->>'odoo_lot_id')::INTEGER,
    (row->>'odoo_warehouse_id')::INTEGER,
    SUM((row->>'qty')::DOUBLE PRECISION),
    now()
  FROM jsonb_array_elements(p_rows) row
  WHERE COALESCE(row->>'odoo_lot_id', '') ~ '^[0-9]+$'
    AND COALESCE(row->>'odoo_warehouse_id', '') ~ '^[0-9]+$'
    AND COALESCE(row->>'qty', '') ~ '^[0-9]+([.][0-9]+)?$'
  GROUP BY (row->>'odoo_lot_id')::INTEGER, (row->>'odoo_warehouse_id')::INTEGER
  HAVING SUM((row->>'qty')::DOUBLE PRECISION) > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.odoo_mirror_state (key, last_synced_at)
  VALUES ('lot_stock', now())
  ON CONFLICT (key) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.pending_odoo_lot_usage(p_warehouse_id INTEGER)
RETURNS TABLE (odoo_lot_id INTEGER, quantity DOUBLE PRECISION)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lu.odoo_lot_id, SUM(lu.quantity)::DOUBLE PRECISION
  FROM public.lot_usages lu
  JOIN public.reposiciones r ON r.id = lu.reposicion_id
  WHERE lu.odoo_lot_id IS NOT NULL
    AND r.odoo_sync_status IN ('pending', 'failed')
    AND r.payload_json->>'odoo_warehouse_id' = p_warehouse_id::TEXT
  GROUP BY lu.odoo_lot_id;
$$;

REVOKE ALL ON FUNCTION public.replace_odoo_lot_stock(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_odoo_lot_stock(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.pending_odoo_lot_usage(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_odoo_lot_usage(INTEGER) TO service_role;
