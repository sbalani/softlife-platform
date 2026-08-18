CREATE TABLE public.machine_warehouse_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  odoo_warehouse_id INTEGER NOT NULL REFERENCES public.odoo_warehouses(odoo_id) ON DELETE RESTRICT,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX machine_warehouse_assignments_active_idx
  ON public.machine_warehouse_assignments(machine_id) WHERE valid_to IS NULL;
CREATE INDEX machine_warehouse_assignments_history_idx
  ON public.machine_warehouse_assignments(machine_id, valid_from DESC);

INSERT INTO public.machine_warehouse_assignments(machine_id, odoo_warehouse_id)
SELECT id, odoo_warehouse_id FROM public.machines WHERE odoo_warehouse_id IS NOT NULL
ON CONFLICT (machine_id) WHERE valid_to IS NULL DO NOTHING;

UPDATE public.machine_warehouse_assignments SET valid_from = TIMESTAMPTZ '2020-01-01'
WHERE valid_to IS NULL;

CREATE OR REPLACE FUNCTION public.track_machine_warehouse_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.odoo_warehouse_id IS NOT DISTINCT FROM OLD.odoo_warehouse_id THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
  UPDATE public.machine_warehouse_assignments SET valid_to = now()
    WHERE machine_id = NEW.id AND valid_to IS NULL;
  END IF;
  IF NEW.odoo_warehouse_id IS NOT NULL THEN
    INSERT INTO public.machine_warehouse_assignments(machine_id, odoo_warehouse_id)
    VALUES (NEW.id, NEW.odoo_warehouse_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machines_track_warehouse_assignment ON public.machines;
CREATE TRIGGER machines_track_warehouse_assignment
AFTER INSERT OR UPDATE ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.track_machine_warehouse_assignment();

CREATE TABLE public.service_action_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid UUID NOT NULL UNIQUE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  operator_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('cleaning', 'refill', 'both', 'other')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'voided')),
  notes TEXT,
  cleaning_material_used BOOLEAN,
  water_bucket_count INTEGER CHECK (water_bucket_count BETWEEN 0 AND 20),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'machine_qr', 'mobile', 'api')),
  assigned_warehouse_id INTEGER REFERENCES public.odoo_warehouses(odoo_id) ON DELETE SET NULL,
  provenance_status TEXT NOT NULL DEFAULT 'resolved'
    CHECK (provenance_status IN ('unresolved', 'partially_resolved', 'resolved', 'voided')),
  cleaning_projection_status TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (cleaning_projection_status IN ('not_applicable', 'pending', 'complete', 'failed')),
  refill_projection_status TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (refill_projection_status IN ('not_applicable', 'pending', 'partial', 'complete', 'failed')),
  projection_error TEXT,
  submission_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_action_reports_machine_time_idx
  ON public.service_action_reports(machine_id, occurred_at DESC);
CREATE INDEX service_action_reports_provenance_idx
  ON public.service_action_reports(provenance_status, occurred_at DESC)
  WHERE status = 'confirmed' AND provenance_status <> 'resolved';

CREATE TABLE public.service_action_refill_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.service_action_reports(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number BETWEEN 1 AND 20),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'unit',
  product_name TEXT,
  observed_lot_code TEXT,
  observed_odoo_lot_id INTEGER,
  provenance_status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (provenance_status IN ('unresolved', 'partially_resolved', 'resolved', 'voided')),
  unresolved_reason TEXT CHECK (unresolved_reason IN (
    'warehouse_unknown', 'lot_unknown', 'lot_not_in_inventory', 'transfer_missing',
    'insufficient_stock', 'allocation_pending', 'other'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_id, line_number)
);

CREATE INDEX service_action_refill_lines_gap_idx
  ON public.service_action_refill_lines(provenance_status, created_at DESC)
  WHERE provenance_status <> 'resolved';

CREATE TABLE public.service_action_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.service_action_reports(id) ON DELETE CASCADE,
  refill_line_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'audio')),
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.service_action_refill_lines ADD CONSTRAINT service_action_refill_lines_report_id_id_key UNIQUE(report_id, id);
ALTER TABLE public.service_action_attachments ADD CONSTRAINT service_action_attachments_report_line_fk
  FOREIGN KEY (report_id, refill_line_id) REFERENCES public.service_action_refill_lines(report_id, id) ON DELETE CASCADE;

CREATE TABLE public.service_action_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.service_action_reports(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);

CREATE TABLE public.refill_stock_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refill_line_id UUID NOT NULL REFERENCES public.service_action_refill_lines(id) ON DELETE CASCADE,
  odoo_warehouse_id INTEGER NOT NULL REFERENCES public.odoo_warehouses(odoo_id) ON DELETE RESTRICT,
  odoo_lot_id INTEGER NOT NULL REFERENCES public.odoo_lots(odoo_id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(refill_line_id, odoo_warehouse_id, odoo_lot_id)
);

CREATE TABLE public.warehouse_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_warehouse_id INTEGER NOT NULL REFERENCES public.odoo_warehouses(odoo_id) ON DELETE RESTRICT,
  odoo_lot_id INTEGER NOT NULL REFERENCES public.odoo_lots(odoo_id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity <> 0),
  movement_kind TEXT NOT NULL CHECK (movement_kind IN ('transfer_in', 'transfer_out', 'refill', 'adjustment')),
  refill_allocation_id UUID REFERENCES public.refill_stock_allocations(id) ON DELETE SET NULL,
  reference TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clean_logs
  ADD COLUMN IF NOT EXISTS service_action_report_id UUID REFERENCES public.service_action_reports(id) ON DELETE SET NULL;
ALTER TABLE public.reposiciones
  ADD COLUMN IF NOT EXISTS service_action_report_id UUID REFERENCES public.service_action_reports(id) ON DELETE SET NULL;
ALTER TABLE public.lot_usages
  ADD COLUMN IF NOT EXISTS service_action_refill_line_id UUID REFERENCES public.service_action_refill_lines(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX clean_logs_service_action_report_idx
  ON public.clean_logs(service_action_report_id) WHERE service_action_report_id IS NOT NULL;
CREATE UNIQUE INDEX reposiciones_service_action_report_idx
  ON public.reposiciones(service_action_report_id) WHERE service_action_report_id IS NOT NULL;
CREATE UNIQUE INDEX lot_usages_service_action_line_idx
  ON public.lot_usages(service_action_refill_line_id) WHERE service_action_refill_line_id IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'service-action-evidence', 'service-action-evidence', false, 20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.machine_warehouse_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_refill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refill_stock_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_refill_stock_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_quantity NUMERIC;
  v_allocated NUMERIC;
  v_stock NUMERIC;
BEGIN
  SELECT quantity INTO v_line_quantity FROM public.service_action_refill_lines WHERE id = NEW.refill_line_id FOR UPDATE;
  SELECT COALESCE(SUM(quantity), 0) INTO v_allocated FROM public.refill_stock_allocations
    WHERE refill_line_id = NEW.refill_line_id AND id IS DISTINCT FROM NEW.id;
  IF v_allocated + NEW.quantity > v_line_quantity THEN RAISE EXCEPTION 'Allocations exceed the physical refill quantity'; END IF;

  SELECT qty INTO v_stock FROM public.odoo_lot_stock
    WHERE odoo_warehouse_id = NEW.odoo_warehouse_id AND odoo_lot_id = NEW.odoo_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot stock is not recorded in this warehouse'; END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO v_allocated FROM public.refill_stock_allocations
    WHERE odoo_warehouse_id = NEW.odoo_warehouse_id AND odoo_lot_id = NEW.odoo_lot_id AND id IS DISTINCT FROM NEW.id;
  IF v_allocated + NEW.quantity > v_stock THEN RAISE EXCEPTION 'Allocation exceeds recorded warehouse stock'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refill_stock_allocations_enforce
BEFORE INSERT OR UPDATE ON public.refill_stock_allocations
FOR EACH ROW EXECUTE FUNCTION public.enforce_refill_stock_allocation();

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
  IF p_status = 'confirmed' AND v_has_cleaning AND (p_cleaning_material_used IS NULL OR p_water_bucket_count IS NULL OR p_water_bucket_count NOT BETWEEN 0 AND 20) THEN RAISE EXCEPTION 'Cleaning details are required'; END IF;
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
      cleaning_projection_status = CASE WHEN v_has_cleaning AND p_status = 'confirmed' THEN 'pending' WHEN v_has_cleaning THEN 'not_applicable' ELSE 'not_applicable' END,
      refill_projection_status = CASE WHEN v_has_refill AND p_status = 'confirmed' THEN 'pending' WHEN v_has_refill THEN 'not_applicable' ELSE 'not_applicable' END,
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
      v_lot_id := NULL;
      v_lot_name := NULL;
      v_lot_product := NULL;
      v_stock_qty := NULL;
      IF COALESCE(v_line->>'odoo_lot_id', '') ~ '^[0-9]+$' THEN
        SELECT odoo_id, name, product_name INTO v_lot_id, v_lot_name, v_lot_product
          FROM public.odoo_lots WHERE odoo_id = (v_line->>'odoo_lot_id')::INTEGER;
      END IF;
      IF v_warehouse_id IS NULL THEN v_reason := 'warehouse_unknown'; v_line_status := 'unresolved';
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
          IF v_stock_qty - v_pending_qty < (v_line->>'quantity')::NUMERIC THEN v_reason := 'insufficient_stock'; v_line_status := 'partially_resolved';
          ELSE v_reason := 'allocation_pending'; v_line_status := 'partially_resolved'; END IF;
        END IF;
      END IF;
      IF v_line_status = 'unresolved' THEN v_overall_status := 'unresolved';
      ELSIF v_overall_status = 'resolved' THEN v_overall_status := 'partially_resolved'; END IF;
      INSERT INTO public.service_action_refill_lines(
        report_id, line_number, quantity, unit, product_name, observed_lot_code, observed_odoo_lot_id,
        provenance_status, unresolved_reason
      ) VALUES (
        v_report.id, v_line_number, (v_line->>'quantity')::NUMERIC, COALESCE(NULLIF(btrim(v_line->>'unit'), ''), 'unit'),
        COALESCE(NULLIF(btrim(v_line->>'product_name'), ''), v_lot_product),
        COALESCE(NULLIF(btrim(v_line->>'lot_code'), ''), v_lot_name), v_lot_id,
        v_line_status, v_reason
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
        IF v_line_row.observed_odoo_lot_id IS NOT NULL AND v_warehouse_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.odoo_lot_stock WHERE odoo_warehouse_id = v_warehouse_id AND odoo_lot_id = v_line_row.observed_odoo_lot_id) THEN
          SELECT odoo_id, name, product_name INTO v_lot_id, v_lot_name, v_lot_product
            FROM public.odoo_lots WHERE odoo_id = v_line_row.observed_odoo_lot_id;
          INSERT INTO public.lot_usages(
            machine_id, machine_name, device_imei, product_name, product_type, lot_name, quantity,
            operator_id, device_event_time, odoo_lot_id, reposicion_id, service_action_refill_line_id
          ) VALUES (
            p_machine_id, v_machine.name, v_machine.device_imei, COALESCE(v_line_row.product_name, v_lot_product),
            'unknown', COALESCE(v_line_row.observed_lot_code, v_lot_name), v_line_row.quantity,
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
