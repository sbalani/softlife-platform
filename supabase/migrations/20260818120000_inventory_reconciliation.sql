ALTER TABLE public.refill_stock_allocations
  ADD COLUMN client_uuid UUID,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN stock_quantity NUMERIC,
  ADD COLUMN stock_unit TEXT,
  ADD COLUMN conversion_note TEXT,
  ADD COLUMN confirmed_by UUID,
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN voided_by UUID,
  ADD COLUMN voided_at TIMESTAMPTZ,
  ADD COLUMN void_reason TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.refill_stock_allocations)
    OR EXISTS (SELECT 1 FROM public.warehouse_stock_movements) THEN
    RAISE EXCEPTION 'Phase 2 baseline requires empty allocation and movement tables';
  END IF;
END $$;

UPDATE public.refill_stock_allocations SET
  client_uuid = id,
  stock_quantity = quantity,
  stock_unit = 'unit',
  confirmed_by = created_by,
  confirmed_at = created_at;

ALTER TABLE public.refill_stock_allocations
  ALTER COLUMN client_uuid SET NOT NULL,
  ALTER COLUMN stock_quantity SET NOT NULL,
  ALTER COLUMN stock_unit SET NOT NULL,
  ALTER COLUMN confirmed_by SET NOT NULL,
  ALTER COLUMN confirmed_at SET NOT NULL,
  ADD CONSTRAINT refill_stock_allocations_client_uuid_key UNIQUE(client_uuid),
  ADD CONSTRAINT refill_stock_allocations_status_check CHECK (status IN ('confirmed', 'voided')),
  ADD CONSTRAINT refill_stock_allocations_stock_quantity_check CHECK (stock_quantity > 0),
  ADD CONSTRAINT refill_stock_allocations_void_audit_check CHECK (
    (status = 'confirmed' AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL)
    OR (status = 'voided' AND voided_by IS NOT NULL AND voided_at IS NOT NULL AND NULLIF(btrim(void_reason), '') IS NOT NULL AND voided_at >= confirmed_at)
  );

ALTER TABLE public.refill_stock_allocations
  DROP CONSTRAINT IF EXISTS refill_stock_allocations_refill_line_id_odoo_warehouse_id_odoo_lot_id_key;
CREATE UNIQUE INDEX refill_stock_allocations_active_lot_idx
  ON public.refill_stock_allocations(refill_line_id, odoo_warehouse_id, odoo_lot_id)
  WHERE status = 'confirmed';

ALTER TABLE public.warehouse_stock_movements
  DROP CONSTRAINT IF EXISTS warehouse_stock_movements_movement_kind_check;
ALTER TABLE public.warehouse_stock_movements
  ADD COLUMN client_uuid UUID,
  ADD COLUMN tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN movement_group_id UUID,
  ADD COLUMN reversal_of UUID REFERENCES public.warehouse_stock_movements(id) ON DELETE RESTRICT,
  ADD COLUMN reason TEXT,
  ADD COLUMN source TEXT NOT NULL DEFAULT 'platform';

UPDATE public.warehouse_stock_movements SET client_uuid = id;
ALTER TABLE public.warehouse_stock_movements
  ALTER COLUMN client_uuid SET NOT NULL,
  ADD CONSTRAINT warehouse_stock_movements_client_uuid_key UNIQUE(client_uuid),
  ADD CONSTRAINT warehouse_stock_movements_kind_check CHECK (movement_kind IN ('receipt', 'transfer_in', 'transfer_out', 'refill', 'correction', 'adjustment')),
  ADD CONSTRAINT warehouse_stock_movements_sign_check CHECK (
    (movement_kind IN ('receipt', 'transfer_in') AND quantity > 0)
    OR (movement_kind IN ('transfer_out', 'refill') AND quantity < 0)
    OR (movement_kind IN ('correction', 'adjustment') AND quantity <> 0)
  ),
  ADD CONSTRAINT warehouse_stock_movements_source_check CHECK (source IN ('platform', 'odoo_import', 'legacy'));
ALTER TABLE public.warehouse_stock_movements ADD CONSTRAINT warehouse_stock_movements_group_check CHECK (
  (movement_kind IN ('transfer_in', 'transfer_out') AND movement_group_id IS NOT NULL)
  OR (movement_kind NOT IN ('transfer_in', 'transfer_out') AND movement_group_id IS NULL)
);

CREATE UNIQUE INDEX warehouse_stock_movements_refill_allocation_idx
  ON public.warehouse_stock_movements(refill_allocation_id) WHERE refill_allocation_id IS NOT NULL;
CREATE INDEX warehouse_stock_movements_balance_idx
  ON public.warehouse_stock_movements(odoo_warehouse_id, odoo_lot_id, occurred_at DESC);
CREATE INDEX warehouse_stock_movements_group_idx
  ON public.warehouse_stock_movements(movement_group_id) WHERE movement_group_id IS NOT NULL;
CREATE UNIQUE INDEX warehouse_stock_movements_one_reversal_idx
  ON public.warehouse_stock_movements(reversal_of) WHERE reversal_of IS NOT NULL;
CREATE UNIQUE INDEX warehouse_stock_movements_transfer_out_idx
  ON public.warehouse_stock_movements(movement_group_id) WHERE movement_kind = 'transfer_out';
CREATE UNIQUE INDEX warehouse_stock_movements_transfer_in_idx
  ON public.warehouse_stock_movements(movement_group_id) WHERE movement_kind = 'transfer_in';

CREATE TABLE public.warehouse_stock_movement_sync (
  movement_id UUID PRIMARY KEY REFERENCES public.warehouse_stock_movements(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry_wait', 'accepted_awaiting_mirror', 'reconciled', 'failed', 'cancelled')),
  external_reference TEXT NOT NULL UNIQUE,
  odoo_external_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  reflected_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX warehouse_stock_movement_sync_queue_idx
  ON public.warehouse_stock_movement_sync(status, next_attempt_at, updated_at);
ALTER TABLE public.warehouse_stock_movement_sync ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_warehouse_movement_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Warehouse stock movements are append-only; create a correction or reversal';
END;
$$;
CREATE TRIGGER warehouse_stock_movements_append_only
BEFORE UPDATE OR DELETE ON public.warehouse_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.prevent_warehouse_movement_mutation();

CREATE OR REPLACE FUNCTION public.validate_warehouse_movement_reversal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_original public.warehouse_stock_movements%ROWTYPE;
BEGIN
  IF NEW.reversal_of IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_original FROM public.warehouse_stock_movements WHERE id = NEW.reversal_of FOR SHARE;
  IF NOT FOUND OR v_original.reversal_of IS NOT NULL OR NEW.odoo_warehouse_id <> v_original.odoo_warehouse_id
    OR NEW.odoo_lot_id <> v_original.odoo_lot_id OR NEW.quantity <> -v_original.quantity
    OR NEW.tenant_id IS DISTINCT FROM v_original.tenant_id OR NEW.source <> 'platform'
    OR NEW.movement_kind <> 'correction' OR NULLIF(btrim(NEW.reason), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid warehouse movement reversal';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER warehouse_stock_movements_validate_reversal
BEFORE INSERT ON public.warehouse_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.validate_warehouse_movement_reversal();

CREATE OR REPLACE FUNCTION public.prevent_refill_allocation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Refill allocations cannot be deleted'; END IF;
  IF current_setting('softlife.allow_allocation_void', true) IS DISTINCT FROM 'on'
    OR OLD.status <> 'confirmed' OR NEW.status <> 'voided'
    OR NEW.refill_line_id IS DISTINCT FROM OLD.refill_line_id
    OR NEW.odoo_warehouse_id IS DISTINCT FROM OLD.odoo_warehouse_id
    OR NEW.odoo_lot_id IS DISTINCT FROM OLD.odoo_lot_id
    OR NEW.quantity IS DISTINCT FROM OLD.quantity
    OR NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
    OR NEW.client_uuid IS DISTINCT FROM OLD.client_uuid OR NEW.stock_unit IS DISTINCT FROM OLD.stock_unit
    OR NEW.conversion_note IS DISTINCT FROM OLD.conversion_note OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
    OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'Refill allocations are immutable; use the void function';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER refill_stock_allocations_immutable
BEFORE UPDATE OR DELETE ON public.refill_stock_allocations
FOR EACH ROW EXECUTE FUNCTION public.prevent_refill_allocation_mutation();

CREATE OR REPLACE VIEW public.warehouse_lot_effective_balances
WITH (security_invoker = false)
AS
WITH keys AS (
  SELECT odoo_warehouse_id, odoo_lot_id FROM public.odoo_lot_stock
  UNION
  SELECT odoo_warehouse_id, odoo_lot_id FROM public.warehouse_stock_movements
),
movement_overlay AS (
  SELECT movement.odoo_warehouse_id, movement.odoo_lot_id, COALESCE(SUM(movement.quantity), 0)::NUMERIC AS quantity
  FROM public.warehouse_stock_movements movement
  JOIN public.warehouse_stock_movement_sync sync ON sync.movement_id = movement.id
  WHERE sync.reflected_at IS NULL AND movement.quantity < 0
  GROUP BY movement.odoo_warehouse_id, movement.odoo_lot_id
),
legacy_pending AS (
  SELECT (reposicion.payload_json->>'odoo_warehouse_id')::INTEGER AS odoo_warehouse_id,
    usage.odoo_lot_id, COALESCE(SUM(usage.quantity), 0)::NUMERIC AS quantity
  FROM public.lot_usages usage
  JOIN public.reposiciones reposicion ON reposicion.id = usage.reposicion_id
  WHERE reposicion.odoo_sync_status IN ('pending', 'failed')
    AND COALESCE(reposicion.payload_json->>'odoo_warehouse_id', '') ~ '^[0-9]+$'
    AND reposicion.service_action_report_id IS NULL
    AND usage.quantity > 0 AND usage.quantity NOT IN ('Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION, 'NaN'::DOUBLE PRECISION)
  GROUP BY (reposicion.payload_json->>'odoo_warehouse_id')::INTEGER, usage.odoo_lot_id
)
SELECT keys.odoo_warehouse_id, keys.odoo_lot_id,
  COALESCE(stock.qty, 0)::NUMERIC AS mirror_quantity,
  COALESCE(overlay.quantity, 0)::NUMERIC AS platform_overlay,
  COALESCE(pending.quantity, 0)::NUMERIC AS legacy_reserved,
  (COALESCE(stock.qty, 0) + COALESCE(overlay.quantity, 0) - COALESCE(pending.quantity, 0))::NUMERIC AS effective_quantity
FROM keys
LEFT JOIN public.odoo_lot_stock stock USING (odoo_warehouse_id, odoo_lot_id)
LEFT JOIN movement_overlay overlay USING (odoo_warehouse_id, odoo_lot_id)
LEFT JOIN legacy_pending pending USING (odoo_warehouse_id, odoo_lot_id);

REVOKE ALL ON public.warehouse_lot_effective_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.warehouse_lot_effective_balances TO service_role;

DROP TRIGGER IF EXISTS refill_stock_allocations_enforce ON public.refill_stock_allocations;
CREATE OR REPLACE FUNCTION public.enforce_refill_stock_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_quantity NUMERIC;
  v_allocated NUMERIC;
  v_available NUMERIC;
  v_report_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(814731);
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' AND NEW.status = 'voided' THEN RETURN NEW; END IF;
  SELECT line.quantity, report.status INTO v_line_quantity, v_report_status
  FROM public.service_action_refill_lines line
  JOIN public.service_action_reports report ON report.id = line.report_id
  WHERE line.id = NEW.refill_line_id FOR UPDATE OF line;
  IF v_report_status IS DISTINCT FROM 'confirmed' THEN RAISE EXCEPTION 'Only confirmed Action Reports can be allocated'; END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO v_allocated FROM public.refill_stock_allocations
    WHERE refill_line_id = NEW.refill_line_id AND status = 'confirmed' AND id IS DISTINCT FROM NEW.id;
  IF v_allocated + NEW.quantity > v_line_quantity THEN RAISE EXCEPTION 'Allocations exceed the physical refill quantity'; END IF;
  SELECT effective_quantity INTO v_available FROM public.warehouse_lot_effective_balances
    WHERE odoo_warehouse_id = NEW.odoo_warehouse_id AND odoo_lot_id = NEW.odoo_lot_id;
  IF COALESCE(v_available, 0) < NEW.stock_quantity THEN RAISE EXCEPTION 'Allocation exceeds effective warehouse stock'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER refill_stock_allocations_enforce
BEFORE INSERT OR UPDATE ON public.refill_stock_allocations
FOR EACH ROW EXECUTE FUNCTION public.enforce_refill_stock_allocation();

CREATE OR REPLACE FUNCTION public.recompute_service_action_provenance(p_refill_line_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id UUID;
  v_physical NUMERIC;
  v_allocated NUMERIC;
BEGIN
  SELECT report_id, quantity INTO v_report_id, v_physical
  FROM public.service_action_refill_lines WHERE id = p_refill_line_id FOR UPDATE;
  SELECT COALESCE(SUM(quantity), 0) INTO v_allocated
  FROM public.refill_stock_allocations WHERE refill_line_id = p_refill_line_id AND status = 'confirmed';
  IF v_allocated > v_physical THEN RAISE EXCEPTION 'Confirmed allocations exceed physical quantity'; END IF;
  UPDATE public.service_action_refill_lines SET
    provenance_status = CASE WHEN provenance_status = 'voided' THEN 'voided' WHEN v_allocated = 0 THEN 'unresolved' WHEN v_allocated < v_physical THEN 'partially_resolved' ELSE 'resolved' END,
    unresolved_reason = CASE WHEN provenance_status = 'voided' THEN unresolved_reason WHEN v_allocated >= v_physical THEN NULL ELSE 'allocation_pending' END,
    updated_at = now()
  WHERE id = p_refill_line_id;
  UPDATE public.service_action_reports report SET provenance_status = CASE
    WHEN report.status = 'voided' THEN 'voided'
    WHEN EXISTS (SELECT 1 FROM public.service_action_refill_lines line WHERE line.report_id = report.id AND line.provenance_status = 'unresolved') THEN 'unresolved'
    WHEN EXISTS (SELECT 1 FROM public.service_action_refill_lines line WHERE line.report_id = report.id AND line.provenance_status = 'partially_resolved') THEN 'partially_resolved'
    ELSE 'resolved' END,
    updated_at = now()
  WHERE report.id = v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_refill_stock_allocation(
  p_client_uuid UUID, p_refill_line_id UUID, p_odoo_warehouse_id INTEGER, p_odoo_lot_id INTEGER,
  p_physical_quantity NUMERIC, p_stock_quantity NUMERIC, p_conversion_note TEXT, p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.refill_stock_allocations%ROWTYPE;
  v_allocation public.refill_stock_allocations%ROWTYPE;
  v_line RECORD;
  v_stock_unit TEXT;
  v_movement_id UUID;
  v_tenant_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(814731);
  SELECT * INTO v_existing FROM public.refill_stock_allocations WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    IF v_existing.refill_line_id IS DISTINCT FROM p_refill_line_id OR v_existing.odoo_warehouse_id IS DISTINCT FROM p_odoo_warehouse_id
      OR v_existing.odoo_lot_id IS DISTINCT FROM p_odoo_lot_id OR v_existing.quantity IS DISTINCT FROM p_physical_quantity
      OR v_existing.stock_quantity IS DISTINCT FROM p_stock_quantity THEN RAISE EXCEPTION 'Allocation UUID conflicts with another allocation'; END IF;
    RETURN jsonb_build_object('allocation_id', v_existing.id, 'status', v_existing.status);
  END IF;
  IF p_physical_quantity <= 0 OR p_stock_quantity <= 0 THEN RAISE EXCEPTION 'Allocation quantities must be positive'; END IF;
  SELECT line.quantity, line.unit, line.observed_odoo_lot_id, report.tenant_id, report.assigned_warehouse_id, report.status
    INTO v_line FROM public.service_action_refill_lines line
    JOIN public.service_action_reports report ON report.id = line.report_id
    WHERE line.id = p_refill_line_id FOR UPDATE OF line;
  IF NOT FOUND OR v_line.status <> 'confirmed' THEN RAISE EXCEPTION 'Confirmed refill line not found'; END IF;
  IF v_line.assigned_warehouse_id IS NOT NULL AND v_line.assigned_warehouse_id <> p_odoo_warehouse_id THEN RAISE EXCEPTION 'Allocation must use the warehouse assigned at the action time'; END IF;
  IF v_line.observed_odoo_lot_id IS NOT NULL AND v_line.observed_odoo_lot_id <> p_odoo_lot_id THEN RAISE EXCEPTION 'Allocation lot differs from the observed Odoo lot'; END IF;
  SELECT COALESCE(product.uom, 'unit') INTO v_stock_unit
  FROM public.odoo_lots lot LEFT JOIN public.odoo_products product ON product.odoo_id = lot.odoo_product_id
  WHERE lot.odoo_id = p_odoo_lot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Odoo lot not found'; END IF;
  IF lower(v_line.unit) <> lower(v_stock_unit) AND NULLIF(btrim(p_conversion_note), '') IS NULL THEN RAISE EXCEPTION 'Explain the physical-to-stock unit conversion'; END IF;
  v_tenant_id := v_line.tenant_id;
  INSERT INTO public.refill_stock_allocations(
    client_uuid, refill_line_id, odoo_warehouse_id, odoo_lot_id, quantity, stock_quantity, stock_unit,
    conversion_note, created_by, confirmed_by, confirmed_at
  ) VALUES (
    p_client_uuid, p_refill_line_id, p_odoo_warehouse_id, p_odoo_lot_id, p_physical_quantity, p_stock_quantity,
    v_stock_unit, NULLIF(btrim(p_conversion_note), ''), p_actor_id, p_actor_id, now()
  ) RETURNING * INTO v_allocation;
  INSERT INTO public.warehouse_stock_movements(
    client_uuid, tenant_id, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind,
    refill_allocation_id, reference, occurred_at, created_by, reason
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_odoo_warehouse_id, p_odoo_lot_id, -p_stock_quantity, 'refill',
    v_allocation.id, 'Action Report allocation ' || v_allocation.id, now(), p_actor_id, 'Confirmed refill provenance'
  ) RETURNING id INTO v_movement_id;
  INSERT INTO public.warehouse_stock_movement_sync(movement_id, external_reference)
    VALUES (v_movement_id, 'softlife:' || v_movement_id);
  PERFORM public.recompute_service_action_provenance(p_refill_line_id);
  RETURN jsonb_build_object('allocation_id', v_allocation.id, 'movement_id', v_movement_id, 'status', 'confirmed');
END;
$$;

CREATE OR REPLACE FUNCTION public.void_refill_stock_allocation(
  p_client_uuid UUID, p_allocation_id UUID, p_reason TEXT, p_actor_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allocation public.refill_stock_allocations%ROWTYPE;
  v_original public.warehouse_stock_movements%ROWTYPE;
  v_reversal public.warehouse_stock_movements%ROWTYPE;
  v_sync_status TEXT;
  v_attempt_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(814731);
  PERFORM pg_advisory_xact_lock(814732);
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Void reason is required'; END IF;
  SELECT * INTO v_reversal FROM public.warehouse_stock_movements WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    IF v_reversal.reversal_of IS NULL OR v_reversal.created_by IS DISTINCT FROM p_actor_id OR v_reversal.reason IS DISTINCT FROM btrim(p_reason)
      OR NOT EXISTS (SELECT 1 FROM public.warehouse_stock_movements original WHERE original.id = v_reversal.reversal_of AND original.refill_allocation_id = p_allocation_id)
      THEN RAISE EXCEPTION 'Void UUID conflicts with another movement'; END IF;
    RETURN jsonb_build_object('allocation_id', p_allocation_id, 'reversal_movement_id', v_reversal.id);
  END IF;
  SELECT * INTO v_allocation FROM public.refill_stock_allocations WHERE id = p_allocation_id FOR UPDATE;
  IF NOT FOUND OR v_allocation.status <> 'confirmed' THEN RAISE EXCEPTION 'Confirmed allocation not found'; END IF;
  SELECT * INTO v_original FROM public.warehouse_stock_movements WHERE refill_allocation_id = p_allocation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Allocation movement not found'; END IF;
  SELECT status, attempt_count INTO v_sync_status, v_attempt_count FROM public.warehouse_stock_movement_sync WHERE movement_id = v_original.id FOR UPDATE;
  IF v_sync_status = 'processing' THEN RAISE EXCEPTION 'Wait for the active Odoo attempt before voiding this allocation'; END IF;
  PERFORM set_config('softlife.allow_allocation_void', 'on', true);
  UPDATE public.refill_stock_allocations SET status = 'voided', voided_by = p_actor_id,
    voided_at = now(), void_reason = btrim(p_reason) WHERE id = p_allocation_id;
  INSERT INTO public.warehouse_stock_movements(
    client_uuid, tenant_id, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind,
    reversal_of, reference, occurred_at, created_by, reason
  ) VALUES (
    p_client_uuid, v_original.tenant_id, v_original.odoo_warehouse_id, v_original.odoo_lot_id,
    -v_original.quantity, 'correction', v_original.id, 'Allocation reversal ' || p_allocation_id,
    now(), p_actor_id, btrim(p_reason)
  ) RETURNING * INTO v_reversal;
  IF v_sync_status = 'pending' AND v_attempt_count = 0 THEN
    UPDATE public.warehouse_stock_movement_sync SET status = 'cancelled', reflected_at = now(), lease_owner = NULL,
      lease_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE movement_id = v_original.id;
    INSERT INTO public.warehouse_stock_movement_sync(movement_id, external_reference, status, reflected_at)
      VALUES (v_reversal.id, 'softlife:' || v_reversal.id, 'cancelled', now());
  ELSE
    INSERT INTO public.warehouse_stock_movement_sync(movement_id, external_reference)
      VALUES (v_reversal.id, 'softlife:' || v_reversal.id);
  END IF;
  PERFORM public.recompute_service_action_provenance(v_allocation.refill_line_id);
  RETURN jsonb_build_object('allocation_id', p_allocation_id, 'reversal_movement_id', v_reversal.id);
END; $$;

CREATE OR REPLACE FUNCTION public.record_warehouse_receipt(
  p_client_uuid UUID, p_odoo_warehouse_id INTEGER, p_odoo_lot_id INTEGER, p_quantity NUMERIC,
  p_occurred_at TIMESTAMPTZ, p_reason TEXT, p_actor_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.warehouse_stock_movements%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(814731);
  SELECT * INTO v_row FROM public.warehouse_stock_movements WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    IF v_row.odoo_warehouse_id IS DISTINCT FROM p_odoo_warehouse_id OR v_row.odoo_lot_id IS DISTINCT FROM p_odoo_lot_id
      OR v_row.quantity IS DISTINCT FROM p_quantity OR v_row.movement_kind <> 'receipt'
      OR v_row.occurred_at IS DISTINCT FROM p_occurred_at OR v_row.created_by IS DISTINCT FROM p_actor_id
      OR v_row.reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Movement UUID conflicts with another movement'; END IF;
    RETURN jsonb_build_object('movement_id', v_row.id);
  END IF;
  IF p_client_uuid IS NULL OR p_actor_id IS NULL OR p_occurred_at IS NULL OR p_quantity <= 0 OR NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Positive quantity, actor, time, and reason are required'; END IF;
  INSERT INTO public.warehouse_stock_movements(client_uuid, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind, reference, occurred_at, created_by, reason)
    VALUES (p_client_uuid, p_odoo_warehouse_id, p_odoo_lot_id, p_quantity, 'receipt', 'Platform receipt ' || p_client_uuid, p_occurred_at, p_actor_id, btrim(p_reason)) RETURNING * INTO v_row;
  INSERT INTO public.warehouse_stock_movement_sync(movement_id, external_reference) VALUES (v_row.id, 'softlife:' || v_row.id);
  RETURN jsonb_build_object('movement_id', v_row.id);
END; $$;

CREATE OR REPLACE FUNCTION public.record_warehouse_correction(
  p_client_uuid UUID, p_odoo_warehouse_id INTEGER, p_odoo_lot_id INTEGER, p_quantity NUMERIC,
  p_occurred_at TIMESTAMPTZ, p_reason TEXT, p_actor_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.warehouse_stock_movements%ROWTYPE; v_available NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(814731);
  SELECT * INTO v_row FROM public.warehouse_stock_movements WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    IF v_row.odoo_warehouse_id IS DISTINCT FROM p_odoo_warehouse_id OR v_row.odoo_lot_id IS DISTINCT FROM p_odoo_lot_id
      OR v_row.quantity IS DISTINCT FROM p_quantity OR v_row.movement_kind <> 'correction'
      OR v_row.occurred_at IS DISTINCT FROM p_occurred_at OR v_row.created_by IS DISTINCT FROM p_actor_id
      OR v_row.reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Movement UUID conflicts with another movement'; END IF;
    RETURN jsonb_build_object('movement_id', v_row.id);
  END IF;
  IF p_client_uuid IS NULL OR p_actor_id IS NULL OR p_occurred_at IS NULL OR p_quantity = 0 OR NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Non-zero quantity, actor, time, and reason are required'; END IF;
  SELECT effective_quantity INTO v_available FROM public.warehouse_lot_effective_balances WHERE odoo_warehouse_id = p_odoo_warehouse_id AND odoo_lot_id = p_odoo_lot_id;
  IF COALESCE(v_available, 0) + p_quantity < 0 THEN RAISE EXCEPTION 'Correction would make effective stock negative'; END IF;
  INSERT INTO public.warehouse_stock_movements(client_uuid, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind, reference, occurred_at, created_by, reason)
    VALUES (p_client_uuid, p_odoo_warehouse_id, p_odoo_lot_id, p_quantity, 'correction', 'Platform correction ' || p_client_uuid, p_occurred_at, p_actor_id, btrim(p_reason)) RETURNING * INTO v_row;
  INSERT INTO public.warehouse_stock_movement_sync(movement_id, external_reference) VALUES (v_row.id, 'softlife:' || v_row.id);
  RETURN jsonb_build_object('movement_id', v_row.id);
END; $$;

CREATE OR REPLACE FUNCTION public.record_warehouse_transfer(
  p_client_uuid UUID, p_source_warehouse_id INTEGER, p_destination_warehouse_id INTEGER,
  p_odoo_lot_id INTEGER, p_quantity NUMERIC, p_occurred_at TIMESTAMPTZ, p_reason TEXT, p_actor_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_available NUMERIC; v_out public.warehouse_stock_movements%ROWTYPE; v_in public.warehouse_stock_movements%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(814731);
  SELECT * INTO v_out FROM public.warehouse_stock_movements WHERE movement_group_id = p_client_uuid AND movement_kind = 'transfer_out';
  SELECT * INTO v_in FROM public.warehouse_stock_movements WHERE movement_group_id = p_client_uuid AND movement_kind = 'transfer_in';
  IF v_out.id IS NOT NULL OR v_in.id IS NOT NULL THEN
    IF v_out.id IS NULL OR v_in.id IS NULL OR v_out.odoo_warehouse_id IS DISTINCT FROM p_source_warehouse_id
      OR v_in.odoo_warehouse_id IS DISTINCT FROM p_destination_warehouse_id OR v_out.odoo_lot_id IS DISTINCT FROM p_odoo_lot_id
      OR v_in.odoo_lot_id IS DISTINCT FROM p_odoo_lot_id OR v_out.quantity IS DISTINCT FROM -p_quantity
      OR v_in.quantity IS DISTINCT FROM p_quantity OR v_out.occurred_at IS DISTINCT FROM p_occurred_at
      OR v_out.reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Transfer UUID conflicts with another transfer'; END IF;
    RETURN jsonb_build_object('out_movement_id', v_out.id, 'in_movement_id', v_in.id);
  END IF;
  IF p_client_uuid IS NULL OR p_actor_id IS NULL OR p_occurred_at IS NULL OR p_source_warehouse_id = p_destination_warehouse_id OR p_quantity <= 0 OR NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Valid distinct warehouses, quantity, actor, time, and reason are required'; END IF;
  SELECT effective_quantity INTO v_available FROM public.warehouse_lot_effective_balances WHERE odoo_warehouse_id = p_source_warehouse_id AND odoo_lot_id = p_odoo_lot_id;
  IF COALESCE(v_available, 0) < p_quantity THEN RAISE EXCEPTION 'Transfer exceeds effective source stock'; END IF;
  INSERT INTO public.warehouse_stock_movements(client_uuid, movement_group_id, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind, reference, occurred_at, created_by, reason)
    VALUES (gen_random_uuid(), p_client_uuid, p_source_warehouse_id, p_odoo_lot_id, -p_quantity, 'transfer_out', 'Platform transfer ' || p_client_uuid, p_occurred_at, p_actor_id, btrim(p_reason)) RETURNING * INTO v_out;
  INSERT INTO public.warehouse_stock_movements(client_uuid, movement_group_id, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind, reference, occurred_at, created_by, reason)
    VALUES (gen_random_uuid(), p_client_uuid, p_destination_warehouse_id, p_odoo_lot_id, p_quantity, 'transfer_in', 'Platform transfer ' || p_client_uuid, p_occurred_at, p_actor_id, btrim(p_reason)) RETURNING * INTO v_in;
  INSERT INTO public.warehouse_stock_movement_sync(movement_id, external_reference) VALUES (v_out.id, 'softlife-transfer:' || p_client_uuid || ':out'), (v_in.id, 'softlife-transfer:' || p_client_uuid || ':in');
  RETURN jsonb_build_object('out_movement_id', v_out.id, 'in_movement_id', v_in.id);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_warehouse_stock_movements(p_worker TEXT, p_limit INTEGER DEFAULT 20)
RETURNS TABLE(movement_id UUID, movement_group_id UUID, lease_token UUID, external_reference TEXT, movement_kind TEXT, odoo_warehouse_id INTEGER, odoo_lot_id INTEGER, quantity NUMERIC, occurred_at TIMESTAMPTZ, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(p_worker), '') IS NULL THEN RAISE EXCEPTION 'Worker lease token is required'; END IF;
  PERFORM pg_advisory_xact_lock(814732);
  RETURN QUERY
  WITH operations AS (
    SELECT COALESCE(movement.movement_group_id, movement.id) AS operation_id, MIN(sync.updated_at) AS queued_at,
      gen_random_uuid() AS lease_token
    FROM public.warehouse_stock_movement_sync sync
    JOIN public.warehouse_stock_movements movement ON movement.id = sync.movement_id
    GROUP BY COALESCE(movement.movement_group_id, movement.id)
    HAVING bool_and(
      (sync.status IN ('pending', 'retry_wait') AND (sync.next_attempt_at IS NULL OR sync.next_attempt_at <= now()))
      OR (sync.status = 'processing' AND (sync.lease_expires_at IS NULL OR sync.lease_expires_at < now()))
    )
    ORDER BY MIN(sync.updated_at), COALESCE(movement.movement_group_id, movement.id)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ), updated AS (
    UPDATE public.warehouse_stock_movement_sync sync SET status = 'processing', lease_owner = p_worker,
      lease_token = operations.lease_token,
      lease_expires_at = now() + INTERVAL '5 minutes', attempt_count = attempt_count + 1,
      last_attempt_at = now(), updated_at = now()
    FROM public.warehouse_stock_movements movement, operations
    WHERE sync.movement_id = movement.id AND COALESCE(movement.movement_group_id, movement.id) = operations.operation_id
    RETURNING sync.movement_id, sync.lease_token, sync.external_reference
  )
  SELECT movement.id, movement.movement_group_id, updated.lease_token, updated.external_reference, movement.movement_kind, movement.odoo_warehouse_id,
    movement.odoo_lot_id, movement.quantity, movement.occurred_at, movement.reason
  FROM updated JOIN public.warehouse_stock_movements movement ON movement.id = updated.movement_id;
END; $$;

CREATE OR REPLACE FUNCTION public.record_warehouse_stock_movement_result(
  p_movement_id UUID, p_worker TEXT, p_lease_token UUID, p_accepted BOOLEAN, p_odoo_external_id TEXT,
  p_error TEXT DEFAULT NULL, p_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_operation_id UUID;
BEGIN
  IF NULLIF(btrim(p_worker), '') IS NULL OR p_lease_token IS NULL OR (p_accepted AND NULLIF(btrim(p_odoo_external_id), '') IS NULL) THEN RAISE EXCEPTION 'Worker token and accepted Odoo ID are required'; END IF;
  SELECT COALESCE(movement_group_id, id) INTO v_operation_id FROM public.warehouse_stock_movements WHERE id = p_movement_id;
  IF v_operation_id IS NULL OR EXISTS (
    SELECT 1 FROM public.warehouse_stock_movements movement
    JOIN public.warehouse_stock_movement_sync sync ON sync.movement_id = movement.id
    WHERE COALESCE(movement.movement_group_id, movement.id) = v_operation_id
      AND (sync.status <> 'processing' OR sync.lease_owner IS DISTINCT FROM p_worker
        OR sync.lease_token IS DISTINCT FROM p_lease_token OR sync.lease_expires_at < now())
  ) THEN RAISE EXCEPTION 'Movement lease not found'; END IF;
  UPDATE public.warehouse_stock_movement_sync sync SET
    status = CASE WHEN p_accepted THEN 'accepted_awaiting_mirror' WHEN p_retry_at IS NOT NULL THEN 'retry_wait' ELSE 'failed' END,
    odoo_external_id = CASE WHEN p_accepted THEN p_odoo_external_id ELSE odoo_external_id END,
    accepted_at = CASE WHEN p_accepted THEN now() ELSE accepted_at END,
    next_attempt_at = p_retry_at, last_error = p_error, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  FROM public.warehouse_stock_movements movement
  WHERE sync.movement_id = movement.id AND COALESCE(movement.movement_group_id, movement.id) = v_operation_id
    AND sync.status = 'processing' AND sync.lease_owner = p_worker AND sync.lease_token = p_lease_token AND sync.lease_expires_at >= now();
  IF NOT FOUND THEN RAISE EXCEPTION 'Movement lease not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.replace_odoo_lot_stock_v2(p_payload JSONB, p_reflected_references JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' THEN RAISE EXCEPTION 'Lot stock payload must be an array'; END IF;
  IF p_reflected_references IS NULL OR jsonb_typeof(p_reflected_references) <> 'array' THEN RAISE EXCEPTION 'Reflected references must be an array'; END IF;
  IF jsonb_array_length(p_payload) = 0 OR jsonb_array_length(p_payload) > 100000 THEN RAISE EXCEPTION 'Lot stock payload size is invalid'; END IF;
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

CREATE OR REPLACE FUNCTION public.replace_odoo_lot_stock(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  -- Compatibility path remains conservative: accepted platform movements stay overlaid
  -- until the Odoo importer upgrades to v2 and supplies observed references.
  PERFORM public.replace_odoo_lot_stock_v2(p_rows, '[]'::JSONB);
  SELECT COUNT(*) INTO v_count FROM public.odoo_lot_stock;
  RETURN v_count;
END; $$;

REVOKE INSERT, UPDATE, DELETE ON public.refill_stock_allocations FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.warehouse_stock_movements FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.warehouse_stock_movement_sync FROM anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_refill_stock_allocation(UUID, UUID, INTEGER, INTEGER, NUMERIC, NUMERIC, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_refill_stock_allocation(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_warehouse_receipt(UUID, INTEGER, INTEGER, NUMERIC, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_warehouse_correction(UUID, INTEGER, INTEGER, NUMERIC, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_warehouse_transfer(UUID, INTEGER, INTEGER, INTEGER, NUMERIC, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_warehouse_stock_movements(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_warehouse_stock_movement_result(UUID, TEXT, UUID, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_odoo_lot_stock_v2(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_service_action_provenance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_refill_stock_allocation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_refill_allocation_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_warehouse_movement_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_warehouse_movement_reversal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_refill_stock_allocation(UUID, UUID, INTEGER, INTEGER, NUMERIC, NUMERIC, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_refill_stock_allocation(UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_warehouse_receipt(UUID, INTEGER, INTEGER, NUMERIC, TIMESTAMPTZ, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_warehouse_correction(UUID, INTEGER, INTEGER, NUMERIC, TIMESTAMPTZ, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_warehouse_transfer(UUID, INTEGER, INTEGER, INTEGER, NUMERIC, TIMESTAMPTZ, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_warehouse_stock_movements(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_warehouse_stock_movement_result(UUID, TEXT, UUID, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_odoo_lot_stock_v2(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_service_action_provenance(UUID) TO service_role;
