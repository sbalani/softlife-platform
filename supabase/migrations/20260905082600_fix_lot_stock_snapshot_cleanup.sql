CREATE OR REPLACE FUNCTION public.replace_odoo_lot_stock_v2(p_payload JSONB, p_reflected_references JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' OR jsonb_array_length(p_payload) > 100000 THEN RAISE EXCEPTION 'Lot stock payload is invalid'; END IF;
  IF p_reflected_references IS NULL OR jsonb_typeof(p_reflected_references) <> 'array' THEN RAISE EXCEPTION 'Reflected references must be an array'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_payload) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
    WHERE row.odoo_lot_id IS NULL OR row.odoo_warehouse_id IS NULL OR row.qty IS NULL OR row.qty <= 0
      OR row.qty IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)) THEN RAISE EXCEPTION 'Invalid lot stock row'; END IF;
  IF EXISTS (SELECT 1 FROM (
    SELECT SUM(row.qty) AS qty FROM jsonb_to_recordset(p_payload) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
    GROUP BY row.odoo_lot_id, row.odoo_warehouse_id
  ) aggregate WHERE aggregate.qty IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)) THEN RAISE EXCEPTION 'Invalid aggregate lot stock quantity'; END IF;
  PERFORM pg_advisory_xact_lock(814731);
  DELETE FROM public.odoo_lot_stock WHERE TRUE;
  INSERT INTO public.odoo_lot_stock(odoo_lot_id, odoo_warehouse_id, qty, updated_at)
  SELECT row.odoo_lot_id, row.odoo_warehouse_id, SUM(row.qty), now()
  FROM jsonb_to_recordset(p_payload) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
  GROUP BY row.odoo_lot_id, row.odoo_warehouse_id;
  INSERT INTO public.odoo_mirror_state(key, last_synced_at) VALUES ('lot_stock', now())
    ON CONFLICT (key) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;
  UPDATE public.odoo_lots SET odoo_warehouse_id = NULL, warehouse_name = NULL WHERE TRUE;
  UPDATE public.warehouse_stock_movement_sync sync SET status = 'reconciled', reflected_at = now(), updated_at = now()
  WHERE sync.external_reference IN (SELECT jsonb_array_elements_text(p_reflected_references))
    AND sync.status = 'accepted_awaiting_mirror';
END; $$;

REVOKE ALL ON FUNCTION public.replace_odoo_lot_stock_v2(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_odoo_lot_stock_v2(JSONB, JSONB) TO service_role;
