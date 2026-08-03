CREATE OR REPLACE FUNCTION public.clear_legacy_odoo_lot_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.odoo_mirror_state WHERE key = 'lot_stock') THEN
    NEW.odoo_warehouse_id := NULL;
    NEW.warehouse_name := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS odoo_lots_clear_legacy_location ON public.odoo_lots;
CREATE TRIGGER odoo_lots_clear_legacy_location
BEFORE INSERT OR UPDATE ON public.odoo_lots
FOR EACH ROW EXECUTE FUNCTION public.clear_legacy_odoo_lot_location();

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
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
    WHERE row.odoo_lot_id IS NULL OR row.odoo_lot_id <= 0
      OR row.odoo_warehouse_id IS NULL OR row.odoo_warehouse_id <= 0
      OR row.qty IS NULL OR row.qty <= 0 OR row.qty IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)
  ) THEN
    RAISE EXCEPTION 'Invalid Odoo lot stock row';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('replace_odoo_lot_stock'));
  DELETE FROM public.odoo_lot_stock;
  INSERT INTO public.odoo_lot_stock (odoo_lot_id, odoo_warehouse_id, qty, updated_at)
  SELECT row.odoo_lot_id, row.odoo_warehouse_id, SUM(row.qty), now()
  FROM jsonb_to_recordset(p_rows) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
  GROUP BY row.odoo_lot_id, row.odoo_warehouse_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.odoo_lots SET odoo_warehouse_id = NULL, warehouse_name = NULL
  WHERE odoo_warehouse_id IS NOT NULL OR warehouse_name IS NOT NULL;
  INSERT INTO public.odoo_mirror_state (key, last_synced_at)
  VALUES ('lot_stock', now())
  ON CONFLICT (key) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;
  RETURN v_count;
END;
$$;

UPDATE public.odoo_lots SET odoo_warehouse_id = NULL, warehouse_name = NULL
WHERE EXISTS (SELECT 1 FROM public.odoo_mirror_state WHERE key = 'lot_stock')
  AND (odoo_warehouse_id IS NOT NULL OR warehouse_name IS NOT NULL);
