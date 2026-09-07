ALTER TABLE public.service_action_refill_lines
  ADD COLUMN IF NOT EXISTS finished_bottle BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS left_unfinished_bottle BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_quantity NUMERIC GENERATED ALWAYS AS (
    GREATEST(quantity - CASE WHEN left_unfinished_bottle THEN 1 ELSE 0 END, 0)
  ) STORED;

CREATE OR REPLACE FUNCTION public.enforce_refill_stock_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_quantity NUMERIC;
  v_line_unit TEXT;
  v_allocated NUMERIC;
  v_available NUMERIC;
  v_report_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(814731);
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' AND NEW.status = 'voided' THEN RETURN NEW; END IF;
  SELECT line.inventory_quantity, line.unit, report.status INTO v_line_quantity, v_line_unit, v_report_status
  FROM public.service_action_refill_lines line
  JOIN public.service_action_reports report ON report.id = line.report_id
  WHERE line.id = NEW.refill_line_id FOR UPDATE OF line;
  IF v_report_status IS DISTINCT FROM 'confirmed' THEN RAISE EXCEPTION 'Only confirmed Action Reports can be allocated'; END IF;
  IF lower(v_line_unit) = lower(NEW.stock_unit) AND NEW.quantity <> NEW.stock_quantity THEN
    RAISE EXCEPTION 'Matching units require matching physical and stock quantities';
  END IF;
  IF lower(v_line_unit) <> lower(NEW.stock_unit) AND NULLIF(btrim(NEW.conversion_note), '') IS NULL THEN
    RAISE EXCEPTION 'Explain the physical-to-stock unit conversion';
  END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO v_allocated FROM public.refill_stock_allocations
    WHERE refill_line_id = NEW.refill_line_id AND status = 'confirmed' AND id IS DISTINCT FROM NEW.id;
  IF v_allocated + NEW.quantity > v_line_quantity THEN RAISE EXCEPTION 'Allocations exceed the refill inventory quantity'; END IF;
  SELECT effective_quantity INTO v_available FROM public.warehouse_lot_effective_balances
    WHERE odoo_warehouse_id = NEW.odoo_warehouse_id AND odoo_lot_id = NEW.odoo_lot_id;
  IF COALESCE(v_available, 0) < NEW.stock_quantity THEN RAISE EXCEPTION 'Allocation exceeds effective warehouse stock'; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_refill_stock_allocation() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompute_service_action_provenance(p_refill_line_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id UUID;
  v_inventory_quantity NUMERIC;
  v_allocated NUMERIC;
BEGIN
  SELECT report_id, inventory_quantity INTO v_report_id, v_inventory_quantity
  FROM public.service_action_refill_lines WHERE id = p_refill_line_id FOR UPDATE;
  SELECT COALESCE(SUM(quantity), 0) INTO v_allocated
  FROM public.refill_stock_allocations WHERE refill_line_id = p_refill_line_id AND status = 'confirmed';
  IF v_allocated > v_inventory_quantity THEN RAISE EXCEPTION 'Confirmed allocations exceed refill inventory quantity'; END IF;
  UPDATE public.service_action_refill_lines SET
    provenance_status = CASE WHEN provenance_status = 'voided' THEN 'voided' WHEN v_inventory_quantity = 0 OR v_allocated >= v_inventory_quantity THEN 'resolved' WHEN v_allocated = 0 THEN 'unresolved' ELSE 'partially_resolved' END,
    unresolved_reason = CASE WHEN provenance_status = 'voided' THEN unresolved_reason WHEN v_inventory_quantity = 0 OR v_allocated >= v_inventory_quantity THEN NULL ELSE 'allocation_pending' END,
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

CREATE OR REPLACE FUNCTION public.record_service_action_report(
  p_client_uuid UUID,
  p_machine_id UUID,
  p_operator_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_action_kind TEXT,
  p_status TEXT,
  p_notes TEXT,
  p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER,
  p_refill_lines JSONB,
  p_source TEXT DEFAULT 'web'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.service_action_reports%ROWTYPE;
  v_machine RECORD;
  v_tenant_id UUID;
  v_warehouse_id INTEGER;
  v_payload JSONB;
  v_compat_payload JSONB;
  v_line JSONB;
  v_line_row public.service_action_refill_lines%ROWTYPE;
  v_lot_id INTEGER;
  v_lot_name TEXT;
  v_lot_product TEXT;
  v_stock_qty NUMERIC;
  v_pending_qty NUMERIC;
  v_inventory_qty NUMERIC;
  v_finished_bottle BOOLEAN;
  v_left_unfinished_bottle BOOLEAN;
  v_refill_id UUID;
  v_clean_id UUID;
  v_line_number INTEGER := 0;
  v_refill_projected INTEGER := 0;
  v_reason TEXT;
  v_line_status TEXT;
  v_overall_status TEXT := 'resolved';
  v_projection_errors TEXT[] := ARRAY[]::TEXT[];
  v_has_cleaning BOOLEAN := p_action_kind IN ('cleaning', 'both');
  v_has_refill BOOLEAN := p_action_kind IN ('refill', 'both');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));
  IF p_action_kind NOT IN ('cleaning', 'refill', 'both', 'other') THEN RAISE EXCEPTION 'Invalid action type'; END IF;
  IF p_status NOT IN ('draft', 'confirmed') THEN RAISE EXCEPTION 'Invalid report status'; END IF;
  IF p_source NOT IN ('web', 'machine_qr', 'mobile', 'api') THEN RAISE EXCEPTION 'Invalid report source'; END IF;
  IF p_occurred_at < TIMESTAMPTZ '2020-01-01' OR p_occurred_at > now() + INTERVAL '5 minutes' THEN RAISE EXCEPTION 'Invalid event time'; END IF;
  IF p_refill_lines IS NULL OR jsonb_typeof(p_refill_lines) <> 'array' OR jsonb_array_length(p_refill_lines) > 20 THEN RAISE EXCEPTION 'Invalid refill lines'; END IF;
  IF p_status = 'confirmed' AND v_has_cleaning AND (
    p_cleaning_material_used IS NULL OR (p_water_bucket_count IS NOT NULL AND p_water_bucket_count NOT BETWEEN 0 AND 20)
  ) THEN RAISE EXCEPTION 'Cleaning material evidence is required'; END IF;
  IF p_status = 'confirmed' AND v_has_refill AND jsonb_array_length(p_refill_lines) = 0 THEN RAISE EXCEPTION 'At least one refill line is required'; END IF;
  IF p_status = 'confirmed' AND p_action_kind = 'other' AND NULLIF(btrim(p_notes), '') IS NULL THEN RAISE EXCEPTION 'Notes are required for other actions'; END IF;

  SELECT id, name, device_imei, tenant_id INTO v_machine FROM public.machines WHERE id = p_machine_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  SELECT a.tenant_id INTO v_tenant_id FROM public.machine_franchisee_assignments a
    WHERE a.machine_id = p_machine_id
      AND a.start_date <= (p_occurred_at AT TIME ZONE 'Europe/Madrid')::DATE
      AND (a.end_date IS NULL OR a.end_date >= (p_occurred_at AT TIME ZONE 'Europe/Madrid')::DATE)
    ORDER BY a.start_date DESC LIMIT 1;
  v_tenant_id := COALESCE(v_tenant_id, v_machine.tenant_id);
  SELECT odoo_warehouse_id INTO v_warehouse_id FROM public.machine_warehouse_assignments
    WHERE machine_id = p_machine_id AND valid_from <= p_occurred_at
      AND (valid_to IS NULL OR valid_to > p_occurred_at)
    ORDER BY valid_from DESC LIMIT 1;

  v_payload := jsonb_build_object(
    'machine_id', p_machine_id, 'operator_id', p_operator_id, 'occurred_at', p_occurred_at,
    'action_kind', p_action_kind, 'notes', NULLIF(btrim(p_notes), ''),
    'cleaning_material_used', p_cleaning_material_used, 'water_bucket_count', p_water_bucket_count,
    'refill_lines', p_refill_lines, 'source', p_source
  );

  SELECT * INTO v_report FROM public.service_action_reports WHERE client_uuid = p_client_uuid FOR UPDATE;
  IF FOUND AND v_report.status = 'confirmed' THEN
    IF v_report.submission_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Report UUID conflicts with another confirmed action'; END IF;
    RETURN jsonb_build_object('id', v_report.id, 'status', v_report.status, 'provenance_status', v_report.provenance_status,
      'cleaning_projection_status', v_report.cleaning_projection_status, 'refill_projection_status', v_report.refill_projection_status);
  END IF;

  IF FOUND THEN
    UPDATE public.service_action_reports SET
      tenant_id = v_tenant_id, machine_id = p_machine_id, operator_id = p_operator_id,
      occurred_at = p_occurred_at, action_kind = p_action_kind, status = p_status,
      notes = NULLIF(btrim(p_notes), ''), cleaning_material_used = CASE WHEN v_has_cleaning THEN p_cleaning_material_used END,
      water_bucket_count = CASE WHEN v_has_cleaning THEN p_water_bucket_count END, source = p_source,
      assigned_warehouse_id = v_warehouse_id, submission_payload = v_payload,
      cleaning_projection_status = CASE WHEN v_has_cleaning AND p_status = 'confirmed' THEN 'pending' ELSE 'not_applicable' END,
      refill_projection_status = CASE WHEN v_has_refill AND p_status = 'confirmed' THEN 'pending' ELSE 'not_applicable' END,
      confirmed_at = CASE WHEN p_status = 'confirmed' THEN now() END, updated_at = now()
    WHERE id = v_report.id RETURNING * INTO v_report;
    DELETE FROM public.service_action_refill_lines WHERE report_id = v_report.id;
  ELSE
    INSERT INTO public.service_action_reports(
      client_uuid, tenant_id, machine_id, operator_id, occurred_at, action_kind, status, notes,
      cleaning_material_used, water_bucket_count, source, assigned_warehouse_id, submission_payload,
      cleaning_projection_status, refill_projection_status, confirmed_at
    ) VALUES (
      p_client_uuid, v_tenant_id, p_machine_id, p_operator_id, p_occurred_at, p_action_kind, p_status, NULLIF(btrim(p_notes), ''),
      CASE WHEN v_has_cleaning THEN p_cleaning_material_used END, CASE WHEN v_has_cleaning THEN p_water_bucket_count END,
      p_source, v_warehouse_id, v_payload,
      CASE WHEN v_has_cleaning AND p_status = 'confirmed' THEN 'pending' ELSE 'not_applicable' END,
      CASE WHEN v_has_refill AND p_status = 'confirmed' THEN 'pending' ELSE 'not_applicable' END,
      CASE WHEN p_status = 'confirmed' THEN now() END
    ) RETURNING * INTO v_report;
  END IF;

  IF v_has_refill THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_refill_lines) LOOP
      v_line_number := v_line_number + 1;
      IF COALESCE(v_line->>'quantity', '') !~ '^[0-9]+([.][0-9]+)?$' OR (v_line->>'quantity')::NUMERIC <= 0 THEN RAISE EXCEPTION 'Refill quantities must be positive'; END IF;
      IF v_line ? 'finished_bottle' AND jsonb_typeof(v_line->'finished_bottle') <> 'boolean' THEN RAISE EXCEPTION 'Invalid finished bottle value'; END IF;
      IF v_line ? 'left_unfinished_bottle' AND jsonb_typeof(v_line->'left_unfinished_bottle') <> 'boolean' THEN RAISE EXCEPTION 'Invalid unfinished bottle value'; END IF;
      v_finished_bottle := COALESCE((v_line->>'finished_bottle')::BOOLEAN, false);
      v_left_unfinished_bottle := COALESCE((v_line->>'left_unfinished_bottle')::BOOLEAN, false);
      IF (v_finished_bottle OR v_left_unfinished_bottle) AND (v_line->>'quantity')::NUMERIC <> trunc((v_line->>'quantity')::NUMERIC) THEN
        RAISE EXCEPTION 'Bottle-tracked refill quantities must be whole numbers';
      END IF;
      v_inventory_qty := GREATEST((v_line->>'quantity')::NUMERIC - CASE WHEN v_left_unfinished_bottle THEN 1 ELSE 0 END, 0);
      v_lot_id := NULL;
      v_lot_name := NULL;
      v_lot_product := NULL;
      v_stock_qty := NULL;
      IF COALESCE(v_line->>'odoo_lot_id', '') ~ '^[0-9]+$' THEN
        SELECT odoo_id, name, product_name INTO v_lot_id, v_lot_name, v_lot_product
          FROM public.odoo_lots WHERE odoo_id = (v_line->>'odoo_lot_id')::INTEGER;
      END IF;
      IF v_inventory_qty = 0 THEN v_reason := NULL; v_line_status := 'resolved';
      ELSIF v_warehouse_id IS NULL THEN v_reason := 'warehouse_unknown'; v_line_status := 'unresolved';
      ELSIF COALESCE(v_line->>'odoo_lot_id', '') = '' AND NULLIF(btrim(v_line->>'lot_code'), '') IS NULL THEN v_reason := 'lot_unknown'; v_line_status := 'unresolved';
      ELSIF v_lot_id IS NULL THEN v_reason := 'lot_not_in_inventory'; v_line_status := 'unresolved';
      ELSE
        SELECT qty INTO v_stock_qty FROM public.odoo_lot_stock
          WHERE odoo_warehouse_id = v_warehouse_id AND odoo_lot_id = v_lot_id;
        IF NOT FOUND THEN v_reason := 'transfer_missing'; v_line_status := 'unresolved';
        ELSE
          SELECT COALESCE(SUM(lu.quantity), 0) INTO v_pending_qty
          FROM public.lot_usages lu JOIN public.reposiciones r ON r.id = lu.reposicion_id
          WHERE lu.odoo_lot_id = v_lot_id AND r.odoo_sync_status IN ('pending', 'failed')
            AND r.payload_json->>'odoo_warehouse_id' = v_warehouse_id::TEXT;
          IF v_stock_qty - v_pending_qty < v_inventory_qty THEN v_reason := 'insufficient_stock'; v_line_status := 'partially_resolved';
          ELSE v_reason := 'allocation_pending'; v_line_status := 'partially_resolved'; END IF;
        END IF;
      END IF;
      IF v_line_status = 'unresolved' THEN v_overall_status := 'unresolved';
      ELSIF v_line_status = 'partially_resolved' AND v_overall_status = 'resolved' THEN v_overall_status := 'partially_resolved'; END IF;
      INSERT INTO public.service_action_refill_lines(
        report_id, line_number, quantity, unit, product_name, observed_lot_code, observed_odoo_lot_id,
        finished_bottle, left_unfinished_bottle, provenance_status, unresolved_reason
      ) VALUES (
        v_report.id, v_line_number, (v_line->>'quantity')::NUMERIC, COALESCE(NULLIF(btrim(v_line->>'unit'), ''), 'unit'),
        COALESCE(NULLIF(btrim(v_line->>'product_name'), ''), v_lot_product),
        COALESCE(NULLIF(btrim(v_line->>'lot_code'), ''), v_lot_name), v_lot_id,
        v_finished_bottle, v_left_unfinished_bottle, v_line_status, v_reason
      );
    END LOOP;
  END IF;
  UPDATE public.service_action_reports SET provenance_status = v_overall_status WHERE id = v_report.id;

  IF p_status = 'confirmed' AND v_has_cleaning THEN
    BEGIN
      INSERT INTO public.clean_logs(
        tenant_id, client_uuid, machine_id, operator_id, kind, device_event_time,
        cleaning_material_used, water_bucket_count, odoo_sync_status, service_action_report_id
      ) VALUES (
        v_tenant_id, p_client_uuid, p_machine_id, p_operator_id, 'full', p_occurred_at,
        p_cleaning_material_used, p_water_bucket_count, 'not_required', v_report.id
      ) ON CONFLICT (client_uuid) DO NOTHING RETURNING id INTO v_clean_id;
      IF v_clean_id IS NULL THEN
        SELECT id INTO v_clean_id FROM public.clean_logs
          WHERE client_uuid = p_client_uuid AND machine_id = p_machine_id AND operator_id = p_operator_id
            AND device_event_time = p_occurred_at AND kind = 'full'
            AND cleaning_material_used IS NOT DISTINCT FROM p_cleaning_material_used
            AND water_bucket_count IS NOT DISTINCT FROM p_water_bucket_count;
        IF v_clean_id IS NULL THEN RAISE EXCEPTION 'Cleaning UUID conflicts with another event'; END IF;
        UPDATE public.clean_logs SET service_action_report_id = v_report.id WHERE id = v_clean_id;
      END IF;
      UPDATE public.machines SET last_full_clean_date = GREATEST(COALESCE(last_full_clean_date, p_occurred_at), p_occurred_at)
        WHERE id = p_machine_id;
      UPDATE public.service_action_reports SET cleaning_projection_status = 'complete' WHERE id = v_report.id;
    EXCEPTION WHEN OTHERS THEN
      v_projection_errors := array_append(v_projection_errors, 'cleaning: ' || SQLERRM);
      UPDATE public.service_action_reports SET cleaning_projection_status = 'failed' WHERE id = v_report.id;
    END;
  END IF;

  IF p_status = 'confirmed' AND v_has_refill THEN
    BEGIN
      SELECT jsonb_build_object(
        'visit_uuid', p_client_uuid,
        'source', p_source,
        'machine_id', p_machine_id,
        'operator_id', p_operator_id,
        'device_event_time', p_occurred_at,
        'odoo_warehouse_id', v_warehouse_id,
        'action_report_id', v_report.id,
        'lines', COALESCE(jsonb_agg(jsonb_build_object(
          'odoo_lot_id', observed_odoo_lot_id,
          'lot_name', observed_lot_code,
          'product_name', product_name,
          'quantity_used', quantity,
          'inventory_quantity', inventory_quantity,
          'finished_bottle', finished_bottle,
          'left_unfinished_bottle', left_unfinished_bottle,
          'unit', unit
        ) ORDER BY line_number), '[]'::JSONB)
      ) INTO v_compat_payload
      FROM public.service_action_refill_lines WHERE report_id = v_report.id;
      INSERT INTO public.reposiciones(
        tenant_id, client_uuid, machine_id, operator_id, device_event_time, payload_json,
        status, synced_at, odoo_sync_status, service_action_report_id
      ) VALUES (
        v_tenant_id, p_client_uuid, p_machine_id, p_operator_id, p_occurred_at,
        v_compat_payload,
        'synced', now(), 'not_required', v_report.id
      ) ON CONFLICT (client_uuid) DO NOTHING RETURNING id INTO v_refill_id;
      IF v_refill_id IS NULL THEN
        SELECT id INTO v_refill_id FROM public.reposiciones
          WHERE client_uuid = p_client_uuid AND machine_id = p_machine_id AND operator_id = p_operator_id
            AND device_event_time = p_occurred_at AND payload_json = v_compat_payload;
        IF v_refill_id IS NULL THEN RAISE EXCEPTION 'Refill UUID conflicts with another event'; END IF;
        UPDATE public.reposiciones SET service_action_report_id = v_report.id WHERE id = v_refill_id;
      END IF;
      FOR v_line_row IN SELECT * FROM public.service_action_refill_lines WHERE report_id = v_report.id ORDER BY line_number LOOP
        IF v_line_row.inventory_quantity = 0 THEN
          v_refill_projected := v_refill_projected + 1;
        ELSIF v_line_row.observed_odoo_lot_id IS NOT NULL AND v_warehouse_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.odoo_lot_stock WHERE odoo_warehouse_id = v_warehouse_id AND odoo_lot_id = v_line_row.observed_odoo_lot_id) THEN
          SELECT odoo_id, name, product_name INTO v_lot_id, v_lot_name, v_lot_product
            FROM public.odoo_lots WHERE odoo_id = v_line_row.observed_odoo_lot_id;
          INSERT INTO public.lot_usages(
            machine_id, machine_name, device_imei, product_name, product_type, lot_name, quantity,
            operator_id, device_event_time, odoo_lot_id, reposicion_id, service_action_refill_line_id
          ) VALUES (
            p_machine_id, v_machine.name, v_machine.device_imei, COALESCE(v_line_row.product_name, v_lot_product),
            'unknown', COALESCE(v_line_row.observed_lot_code, v_lot_name), v_line_row.inventory_quantity,
            p_operator_id::TEXT, p_occurred_at, v_lot_id, v_refill_id, v_line_row.id
          ) ON CONFLICT (service_action_refill_line_id) WHERE service_action_refill_line_id IS NOT NULL DO NOTHING;
          v_refill_projected := v_refill_projected + 1;
        END IF;
      END LOOP;
      UPDATE public.service_action_reports SET refill_projection_status =
        CASE WHEN v_refill_projected = v_line_number THEN 'complete' ELSE 'partial' END WHERE id = v_report.id;
    EXCEPTION WHEN OTHERS THEN
      v_projection_errors := array_append(v_projection_errors, 'refill: ' || SQLERRM);
      UPDATE public.service_action_reports SET refill_projection_status = 'failed' WHERE id = v_report.id;
    END;
  END IF;

  UPDATE public.service_action_reports
    SET projection_error = NULLIF(array_to_string(v_projection_errors, '; '), ''), updated_at = now()
    WHERE id = v_report.id RETURNING * INTO v_report;
  RETURN jsonb_build_object('id', v_report.id, 'status', v_report.status, 'provenance_status', v_report.provenance_status,
    'cleaning_projection_status', v_report.cleaning_projection_status, 'refill_projection_status', v_report.refill_projection_status,
    'projection_error', v_report.projection_error);
END;
$$;

REVOKE ALL ON FUNCTION public.record_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT) TO service_role;
