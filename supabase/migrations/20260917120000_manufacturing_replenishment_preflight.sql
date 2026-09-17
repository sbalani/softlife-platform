ALTER TABLE public.production_settings
  ADD COLUMN IF NOT EXISTS replenishment_source_odoo_warehouse_id INTEGER
    REFERENCES public.odoo_warehouses(odoo_id) ON DELETE SET NULL;

ALTER TABLE public.odoo_warehouses
  ADD COLUMN IF NOT EXISTS stock_location_id INTEGER;

ALTER TABLE public.odoo_products
  ADD COLUMN IF NOT EXISTS tracking TEXT NOT NULL DEFAULT 'none'
    CHECK (tracking IN ('none', 'lot', 'serial')),
  ADD COLUMN IF NOT EXISTS uom_rounding NUMERIC NOT NULL DEFAULT 0.01
    CHECK (uom_rounding > 0);

ALTER TABLE public.odoo_lot_stock
  ADD COLUMN IF NOT EXISTS available_qty NUMERIC;
UPDATE public.odoo_lot_stock SET available_qty = qty WHERE available_qty IS NULL;
ALTER TABLE public.odoo_lot_stock ALTER COLUMN available_qty SET NOT NULL;

CREATE TABLE public.odoo_warehouse_product_stock (
  odoo_warehouse_id INTEGER NOT NULL REFERENCES public.odoo_warehouses(odoo_id) ON DELETE CASCADE,
  odoo_product_id INTEGER NOT NULL REFERENCES public.odoo_products(odoo_id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  reserved_quantity NUMERIC NOT NULL,
  available_quantity NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (odoo_warehouse_id, odoo_product_id),
  CHECK (quantity >= 0 AND reserved_quantity >= 0 AND available_quantity >= 0)
);
ALTER TABLE public.odoo_warehouse_product_stock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.odoo_warehouse_product_stock FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.odoo_warehouse_product_stock TO service_role;

ALTER TABLE public.manufacturing_period_exports
  ADD COLUMN IF NOT EXISTS replenishment_result JSONB,
  ADD COLUMN IF NOT EXISTS replenishment_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replenishment_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replenishment_completed_at TIMESTAMPTZ;

ALTER TABLE public.manufacturing_period_exports DROP CONSTRAINT IF EXISTS manufacturing_period_exports_status_check;
ALTER TABLE public.manufacturing_period_exports ADD CONSTRAINT manufacturing_period_exports_status_check CHECK (status IN (
  'draft', 'preparing', 'blocked', 'replenishment_planning', 'replenishment_ready',
  'replenishment_failed', 'ready', 'processing', 'completed', 'failed', 'cancelled'
));

CREATE OR REPLACE FUNCTION public.replace_odoo_stock_snapshot_v3(
  p_lot_payload JSONB, p_product_payload JSONB, p_reflected_references JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_lot_payload IS NULL OR jsonb_typeof(p_lot_payload) <> 'array' OR jsonb_array_length(p_lot_payload) > 100000 THEN
    RAISE EXCEPTION 'Lot stock payload is invalid';
  END IF;
  IF p_product_payload IS NULL OR jsonb_typeof(p_product_payload) <> 'array' OR jsonb_array_length(p_product_payload) > 100000 THEN
    RAISE EXCEPTION 'Product stock payload is invalid';
  END IF;
  IF p_reflected_references IS NULL OR jsonb_typeof(p_reflected_references) <> 'array' THEN
    RAISE EXCEPTION 'Reflected references must be an array';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lot_payload)
      AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty NUMERIC, available_qty NUMERIC)
    WHERE row.odoo_lot_id IS NULL OR row.odoo_warehouse_id IS NULL OR row.qty <= 0
      OR row.available_qty < 0 OR row.available_qty > row.qty
  ) THEN RAISE EXCEPTION 'Invalid lot stock row'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_product_payload)
      AS row(odoo_product_id INTEGER, odoo_warehouse_id INTEGER, quantity NUMERIC, reserved_quantity NUMERIC, available_quantity NUMERIC)
    WHERE row.odoo_product_id IS NULL OR row.odoo_warehouse_id IS NULL OR row.quantity < 0
      OR row.reserved_quantity < 0 OR row.available_quantity < 0 OR row.available_quantity > row.quantity
  ) THEN RAISE EXCEPTION 'Invalid product stock row'; END IF;

  PERFORM pg_advisory_xact_lock(814731);
  DELETE FROM public.odoo_lot_stock WHERE TRUE;
  INSERT INTO public.odoo_lot_stock(odoo_lot_id, odoo_warehouse_id, qty, available_qty, updated_at)
  SELECT row.odoo_lot_id, row.odoo_warehouse_id, SUM(row.qty), SUM(row.available_qty), now()
  FROM jsonb_to_recordset(p_lot_payload)
    AS row(odoo_lot_id INTEGER, odoo_warehouse_id INTEGER, qty NUMERIC, available_qty NUMERIC)
  GROUP BY row.odoo_lot_id, row.odoo_warehouse_id;

  DELETE FROM public.odoo_warehouse_product_stock WHERE TRUE;
  INSERT INTO public.odoo_warehouse_product_stock(
    odoo_warehouse_id, odoo_product_id, quantity, reserved_quantity, available_quantity, updated_at
  )
  SELECT row.odoo_warehouse_id, row.odoo_product_id, SUM(row.quantity), SUM(row.reserved_quantity),
    SUM(row.available_quantity), now()
  FROM jsonb_to_recordset(p_product_payload)
    AS row(odoo_product_id INTEGER, odoo_warehouse_id INTEGER, quantity NUMERIC, reserved_quantity NUMERIC, available_quantity NUMERIC)
  GROUP BY row.odoo_warehouse_id, row.odoo_product_id;

  INSERT INTO public.odoo_mirror_state(key, last_synced_at) VALUES ('warehouse_product_stock', now())
    ON CONFLICT (key) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;
  INSERT INTO public.odoo_mirror_state(key, last_synced_at) VALUES ('lot_stock', now())
    ON CONFLICT (key) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;
  UPDATE public.warehouse_stock_movement_sync sync SET status = 'reconciled', reflected_at = now(), updated_at = now()
  WHERE sync.external_reference IN (SELECT jsonb_array_elements_text(p_reflected_references))
    AND sync.status = 'accepted_awaiting_mirror';
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_manufacturing_export(
  p_export_id UUID, p_expected_orders JSONB, p_payload JSONB, p_payload_sha256 TEXT,
  p_config_snapshot JSONB, p_blocked_reasons JSONB
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_export public.manufacturing_period_exports%ROWTYPE;
  v_expected RECORD;
  v_order public.huaxin_orders%ROWTYPE;
  v_replenishment_required BOOLEAN := COALESCE((p_payload->'replenishment'->>'required')::BOOLEAN, false);
BEGIN
  IF jsonb_typeof(p_expected_orders) <> 'array' OR jsonb_typeof(p_blocked_reasons) <> 'array' THEN
    RAISE EXCEPTION 'Expected orders and blocked reasons must be arrays';
  END IF;
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.status NOT IN ('preparing', 'blocked', 'failed', 'replenishment_planning', 'replenishment_failed') THEN
    RAISE EXCEPTION 'Manufacturing export cannot be rebuilt from status %', v_export.status;
  END IF;
  FOR v_expected IN
    SELECT * FROM jsonb_to_recordset(p_expected_orders) AS item(order_id UUID, export_version BIGINT, export_content_hash TEXT)
    ORDER BY item.order_id
  LOOP
    SELECT * INTO v_order FROM public.huaxin_orders WHERE id = v_expected.order_id FOR UPDATE;
    IF NOT FOUND OR v_order.export_version <> v_expected.export_version
      OR v_order.export_content_hash IS DISTINCT FROM v_expected.export_content_hash THEN
      RAISE EXCEPTION 'Order changed during manufacturing preparation' USING ERRCODE = 'P0003';
    END IF;
    IF EXISTS (SELECT 1 FROM public.manufacturing_period_export_orders membership
      WHERE membership.order_id = v_expected.order_id AND membership.export_id <> p_export_id AND membership.released_at IS NULL) THEN
      RAISE EXCEPTION 'Order already belongs to another production run' USING ERRCODE = 'P0004';
    END IF;
  END LOOP;
  DELETE FROM public.manufacturing_period_export_orders WHERE export_id = p_export_id;
  INSERT INTO public.manufacturing_period_export_orders(export_id, order_id, export_version, export_content_hash)
  SELECT p_export_id, item.order_id, item.export_version, item.export_content_hash
  FROM jsonb_to_recordset(p_expected_orders) AS item(order_id UUID, export_version BIGINT, export_content_hash TEXT);
  UPDATE public.manufacturing_period_exports SET
    status = CASE WHEN jsonb_array_length(p_blocked_reasons) > 0 THEN 'blocked'
      WHEN v_replenishment_required THEN 'replenishment_planning' ELSE 'draft' END,
    consumption_config_snapshot = p_config_snapshot,
    payload = CASE WHEN jsonb_array_length(p_blocked_reasons) > 0 THEN NULL ELSE p_payload END,
    payload_sha256 = CASE WHEN jsonb_array_length(p_blocked_reasons) > 0 THEN NULL ELSE p_payload_sha256 END,
    blocked_reasons = p_blocked_reasons,
    replenishment_result = NULL, replenishment_confirmed_by = NULL,
    replenishment_confirmed_at = NULL, replenishment_completed_at = NULL
  WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

CREATE OR REPLACE FUNCTION public.save_manufacturing_replenishment_plan(
  p_export_id UUID, p_payload JSONB, p_payload_sha256 TEXT, p_actor_id UUID
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND OR v_export.status <> 'replenishment_planning' OR v_export.confirmed_at IS NOT NULL
    OR v_export.replenishment_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Replenishment plan is not editable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin actor not found';
  END IF;
  IF COALESCE((p_payload->'replenishment'->>'plan_complete')::BOOLEAN, false) IS NOT TRUE
    OR jsonb_array_length(COALESCE(p_payload->'replenishment'->'transfers', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A complete replenishment transfer plan is required';
  END IF;
  UPDATE public.manufacturing_period_exports SET payload = p_payload, payload_sha256 = p_payload_sha256
    WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_manufacturing_replenishment(
  p_export_id UUID, p_payload_sha256 TEXT, p_actor_id UUID
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.status = 'replenishment_ready' AND v_export.payload_sha256 = p_payload_sha256 THEN RETURN v_export; END IF;
  IF v_export.status <> 'replenishment_planning' OR v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION 'Replenishment plan is stale or not confirmable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin actor not found'; END IF;
  IF COALESCE((v_export.payload->'replenishment'->>'plan_complete')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Replenishment plan is incomplete';
  END IF;
  UPDATE public.manufacturing_period_exports SET status = 'replenishment_ready',
    replenishment_confirmed_by = p_actor_id, replenishment_confirmed_at = now()
  WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_unconfirmed_manufacturing_export(p_export_id UUID, p_caller TEXT)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.initiated_by <> p_caller THEN RAISE EXCEPTION 'Only the initiating system can cancel this preview' USING ERRCODE = 'P0005'; END IF;
  IF v_export.status = 'cancelled' THEN RETURN v_export; END IF;
  IF v_export.confirmed_at IS NOT NULL OR v_export.replenishment_confirmed_at IS NOT NULL
    OR v_export.status NOT IN ('draft', 'blocked', 'replenishment_planning') THEN
    RAISE EXCEPTION 'Only an unconfirmed preview can be cancelled' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.manufacturing_period_export_orders SET released_at = v_now WHERE export_id = p_export_id AND released_at IS NULL;
  UPDATE public.manufacturing_period_exports SET status = 'cancelled' WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

CREATE OR REPLACE FUNCTION public.record_manufacturing_replenishment_result(
  p_export_id UUID, p_payload_sha256 TEXT, p_result JSONB
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_accepted BOOLEAN;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND OR v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION 'Replenishment result does not match the frozen run' USING ERRCODE = 'P0002';
  END IF;
  IF v_export.replenishment_result = p_result THEN RETURN v_export; END IF;
  IF v_export.status NOT IN ('replenishment_ready', 'replenishment_failed') THEN
    RAISE EXCEPTION 'Run is not awaiting a replenishment result' USING ERRCODE = 'P0001';
  END IF;
  v_accepted := COALESCE((p_result->>'accepted')::BOOLEAN, false);
  UPDATE public.manufacturing_period_exports SET
    status = CASE WHEN v_accepted THEN 'draft' ELSE 'replenishment_failed' END,
    replenishment_result = p_result,
    replenishment_completed_at = CASE WHEN v_accepted THEN now() ELSE NULL END
  WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

CREATE OR REPLACE FUNCTION public.retry_manufacturing_replenishment(p_export_id UUID, p_actor_id UUID)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND OR v_export.status <> 'replenishment_failed' OR v_export.replenishment_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only a confirmed failed replenishment can be retried' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin actor not found'; END IF;
  UPDATE public.manufacturing_period_exports SET status = 'replenishment_ready', replenishment_result = NULL
    WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END; $$;

CREATE OR REPLACE FUNCTION public.protect_frozen_manufacturing_export()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (OLD.confirmed_at IS NOT NULL OR OLD.replenishment_confirmed_at IS NOT NULL) AND (
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by OR NEW.period_from IS DISTINCT FROM OLD.period_from
    OR NEW.period_to IS DISTINCT FROM OLD.period_to OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
    OR NEW.document_date IS DISTINCT FROM OLD.document_date OR NEW.consumption_config_snapshot IS DISTINCT FROM OLD.consumption_config_snapshot
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
    OR NEW.blocked_reasons IS DISTINCT FROM OLD.blocked_reasons
  ) THEN RAISE EXCEPTION 'Confirmed manufacturing exports are immutable'; END IF;
  IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN RAISE EXCEPTION 'Completed manufacturing exports cannot be reopened'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.protect_frozen_export_membership()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_export_id UUID; v_frozen BOOLEAN;
BEGIN
  v_export_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.export_id ELSE OLD.export_id END;
  SELECT confirmed_at IS NOT NULL OR replenishment_confirmed_at IS NOT NULL INTO v_frozen
    FROM public.manufacturing_period_exports WHERE id = v_export_id;
  IF v_frozen THEN RAISE EXCEPTION 'Confirmed manufacturing export membership is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.replace_odoo_stock_snapshot_v3(JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_manufacturing_replenishment_plan(UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_manufacturing_replenishment(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_manufacturing_replenishment_result(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_manufacturing_replenishment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_odoo_stock_snapshot_v3(JSONB, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_manufacturing_replenishment_plan(UUID, JSONB, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_manufacturing_replenishment(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_manufacturing_replenishment_result(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_manufacturing_replenishment(UUID, UUID) TO service_role;
