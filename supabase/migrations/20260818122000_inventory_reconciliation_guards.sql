CREATE OR REPLACE FUNCTION public.guard_refill_allocation_void_sync_state()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT; v_attempt_count INTEGER;
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status = 'voided' THEN
    SELECT sync.status, sync.attempt_count INTO v_status, v_attempt_count
    FROM public.warehouse_stock_movements movement
    JOIN public.warehouse_stock_movement_sync sync ON sync.movement_id = movement.id
    WHERE movement.refill_allocation_id = OLD.id FOR UPDATE OF sync;
    IF NOT ((v_status = 'pending' AND v_attempt_count = 0) OR v_status IN ('accepted_awaiting_mirror', 'reconciled')) THEN
      RAISE EXCEPTION 'Resolve the uncertain Odoo movement state before voiding this allocation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER refill_stock_allocations_guard_void_sync
BEFORE UPDATE ON public.refill_stock_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_refill_allocation_void_sync_state();

CREATE OR REPLACE FUNCTION public.validate_refill_allocation_observation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_observed_id INTEGER; v_observed_code TEXT; v_lot_code TEXT;
BEGIN
  SELECT observed_odoo_lot_id, observed_lot_code INTO v_observed_id, v_observed_code
  FROM public.service_action_refill_lines WHERE id = NEW.refill_line_id;
  SELECT name INTO v_lot_code FROM public.odoo_lots WHERE odoo_id = NEW.odoo_lot_id;
  IF v_observed_id IS NOT NULL AND v_observed_id <> NEW.odoo_lot_id THEN
    RAISE EXCEPTION 'Allocation lot differs from the observed Odoo lot';
  END IF;
  IF v_observed_id IS NULL AND NULLIF(btrim(v_observed_code), '') IS NOT NULL
    AND lower(btrim(v_observed_code)) <> lower(btrim(v_lot_code)) THEN
    RAISE EXCEPTION 'Allocation lot differs from the observed lot code';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER refill_stock_allocations_validate_observation
BEFORE INSERT ON public.refill_stock_allocations
FOR EACH ROW EXECUTE FUNCTION public.validate_refill_allocation_observation();

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
  DELETE FROM public.odoo_lot_stock;
  INSERT INTO public.odoo_lot_stock(odoo_lot_id, odoo_warehouse_id, qty, updated_at)
  SELECT row.odoo_lot_id, row.odoo_warehouse_id, SUM(row.qty), now()
  FROM jsonb_to_recordset(p_payload) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
  GROUP BY row.odoo_lot_id, row.odoo_warehouse_id;
  INSERT INTO public.odoo_mirror_state(key, last_synced_at) VALUES ('lot_stock', now())
    ON CONFLICT (key) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;
  UPDATE public.odoo_lots SET odoo_warehouse_id = NULL, warehouse_name = NULL;
  UPDATE public.warehouse_stock_movement_sync sync SET status = 'reconciled', reflected_at = now(), updated_at = now()
  WHERE sync.external_reference IN (SELECT jsonb_array_elements_text(p_reflected_references))
    AND sync.status = 'accepted_awaiting_mirror';
END; $$;

REVOKE ALL ON FUNCTION public.guard_refill_allocation_void_sync_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_refill_allocation_observation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_odoo_lot_stock_v2(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_odoo_lot_stock_v2(JSONB, JSONB) TO service_role;
