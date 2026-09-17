CREATE OR REPLACE FUNCTION public.replace_odoo_lot_stock_v2(p_payload JSONB, p_reflected_references JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' OR jsonb_array_length(p_payload) > 100000 THEN RAISE EXCEPTION 'Lot stock payload is invalid'; END IF;
  IF p_reflected_references IS NULL OR jsonb_typeof(p_reflected_references) <> 'array' THEN RAISE EXCEPTION 'Reflected references must be an array'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_payload) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
    WHERE row.odoo_lot_id IS NULL OR row.odoo_warehouse_id IS NULL OR row.qty IS NULL OR row.qty <= 0
      OR row.qty IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)) THEN RAISE EXCEPTION 'Invalid lot stock row'; END IF;
  PERFORM pg_advisory_xact_lock(814731);
  DELETE FROM public.odoo_lot_stock WHERE TRUE;
  INSERT INTO public.odoo_lot_stock(odoo_lot_id, odoo_warehouse_id, qty, available_qty, updated_at)
  SELECT row.odoo_lot_id, row.odoo_warehouse_id, SUM(row.qty), SUM(row.qty), now()
  FROM jsonb_to_recordset(p_payload) AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty DOUBLE PRECISION)
  GROUP BY row.odoo_lot_id, row.odoo_warehouse_id;
  INSERT INTO public.odoo_mirror_state(key, last_synced_at) VALUES ('lot_stock', now())
    ON CONFLICT (key) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;
  UPDATE public.odoo_lots SET odoo_warehouse_id = NULL, warehouse_name = NULL WHERE TRUE;
  UPDATE public.warehouse_stock_movement_sync sync SET status = 'reconciled', reflected_at = now(), updated_at = now()
  WHERE sync.external_reference IN (SELECT jsonb_array_elements_text(p_reflected_references))
    AND sync.status = 'accepted_awaiting_mirror';
END; $$;

CREATE OR REPLACE FUNCTION public.replace_odoo_stock_snapshot_v4(
  p_lot_payload JSONB, p_product_payload JSONB, p_reflected_references JSONB, p_observed_at TIMESTAMPTZ
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_observed_at IS NULL OR p_observed_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'Snapshot observation time is invalid'; END IF;
  PERFORM public.replace_odoo_stock_snapshot_v3(p_lot_payload, p_product_payload, p_reflected_references);
  UPDATE public.odoo_mirror_state SET last_synced_at = p_observed_at
    WHERE key IN ('warehouse_product_stock', 'lot_stock');
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_manufacturing_replenishment(
  p_export_id UUID, p_payload_sha256 TEXT, p_actor_id UUID
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_observed_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.status = 'replenishment_ready' AND v_export.payload_sha256 = p_payload_sha256 THEN RETURN v_export; END IF;
  IF v_export.status <> 'replenishment_planning' OR v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION 'Replenishment plan is stale or not confirmable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin actor not found'; END IF;
  IF COALESCE((v_export.payload->'replenishment'->>'plan_complete')::BOOLEAN, false) IS NOT TRUE THEN RAISE EXCEPTION 'Replenishment plan is incomplete'; END IF;
  BEGIN v_observed_at := (v_export.payload->'replenishment'->>'observed_at')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Replenishment snapshot timestamp is invalid'; END;
  IF v_observed_at IS NULL OR v_observed_at < now() - interval '2 hours' THEN
    RAISE EXCEPTION 'Replenishment stock snapshot is more than two hours old' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.manufacturing_period_exports SET status = 'replenishment_ready',
    replenishment_confirmed_by = p_actor_id, replenishment_confirmed_at = now()
  WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

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
    IF jsonb_typeof(p_result->'picking_ids') <> 'array' THEN RAISE EXCEPTION 'Accepted replenishment requires picking IDs'; END IF;
    SELECT count(DISTINCT value) INTO v_received_count FROM jsonb_array_elements_text(p_result->'picking_ids');
    IF v_expected_count = 0 OR v_received_count <> v_expected_count
      OR jsonb_array_length(p_result->'picking_ids') <> v_expected_count THEN
      RAISE EXCEPTION 'Accepted replenishment result does not cover every frozen transfer';
    END IF;
  END IF;
  UPDATE public.manufacturing_period_exports SET
    status = CASE WHEN v_accepted THEN 'draft' ELSE 'replenishment_failed' END,
    replenishment_result = p_result,
    replenishment_completed_at = CASE WHEN v_accepted THEN now() ELSE NULL END
  WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

CREATE OR REPLACE FUNCTION public.protect_frozen_export_membership()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_export_id UUID; v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  v_export_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.export_id ELSE OLD.export_id END;
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = v_export_id;
  IF v_export.confirmed_at IS NOT NULL OR v_export.replenishment_confirmed_at IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
      AND NEW.export_id = OLD.export_id AND NEW.order_id = OLD.order_id
      AND NEW.export_version = OLD.export_version AND NEW.export_content_hash = OLD.export_content_hash
      AND v_export.status = 'draft' AND v_export.replenishment_completed_at IS NOT NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Confirmed manufacturing export membership is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_unconfirmed_manufacturing_export(p_export_id UUID, p_caller TEXT)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_now TIMESTAMPTZ := now(); v_post_replenishment BOOLEAN;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.initiated_by <> p_caller THEN RAISE EXCEPTION 'Only the initiating system can cancel this preview' USING ERRCODE = 'P0005'; END IF;
  IF v_export.status = 'cancelled' THEN RETURN v_export; END IF;
  v_post_replenishment := v_export.status = 'draft' AND v_export.replenishment_completed_at IS NOT NULL AND v_export.confirmed_at IS NULL;
  IF v_export.confirmed_at IS NOT NULL OR (v_export.replenishment_confirmed_at IS NOT NULL AND NOT v_post_replenishment)
    OR v_export.status NOT IN ('draft', 'blocked', 'replenishment_planning') THEN
    RAISE EXCEPTION 'Only an unconfirmed preview can be cancelled' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.manufacturing_period_export_orders SET released_at = v_now WHERE export_id = p_export_id AND released_at IS NULL;
  UPDATE public.manufacturing_period_exports SET status = 'cancelled' WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

REVOKE ALL ON FUNCTION public.replace_odoo_stock_snapshot_v4(JSONB, JSONB, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_odoo_stock_snapshot_v4(JSONB, JSONB, JSONB, TIMESTAMPTZ) TO service_role;
