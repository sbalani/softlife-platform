ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS odoo_warehouse_id INTEGER REFERENCES public.odoo_warehouses(odoo_id) ON DELETE SET NULL;

ALTER TABLE public.clean_logs
  ADD COLUMN IF NOT EXISTS cleaning_material_used BOOLEAN,
  ADD COLUMN IF NOT EXISTS water_bucket_count INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS odoo_sync_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS odoo_sync_error TEXT;

ALTER TABLE public.reposiciones
  ADD COLUMN IF NOT EXISTS odoo_sync_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS odoo_sync_error TEXT;

ALTER TABLE public.lot_usages
  ADD COLUMN IF NOT EXISTS odoo_lot_id INTEGER,
  ADD COLUMN IF NOT EXISTS reposicion_id UUID REFERENCES public.reposiciones(id) ON DELETE SET NULL;

UPDATE public.clean_logs SET odoo_sync_status = 'not_required'
WHERE cleaning_material_used IS NULL OR water_bucket_count IS NULL;

ALTER TABLE public.clean_logs ALTER COLUMN odoo_sync_status SET DEFAULT 'not_required';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clean_logs_water_bucket_count_check') THEN
    ALTER TABLE public.clean_logs ADD CONSTRAINT clean_logs_water_bucket_count_check
      CHECK (water_bucket_count IS NULL OR water_bucket_count BETWEEN 0 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clean_logs_odoo_sync_status_check') THEN
    ALTER TABLE public.clean_logs ADD CONSTRAINT clean_logs_odoo_sync_status_check
      CHECK (odoo_sync_status IN ('pending', 'synced', 'failed', 'not_required'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reposiciones_odoo_sync_status_check') THEN
    ALTER TABLE public.reposiciones ADD CONSTRAINT reposiciones_odoo_sync_status_check
      CHECK (odoo_sync_status IN ('pending', 'synced', 'failed', 'not_required'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS machines_odoo_warehouse_idx ON public.machines(odoo_warehouse_id);
CREATE INDEX IF NOT EXISTS lot_usages_odoo_lot_idx ON public.lot_usages(odoo_lot_id);
CREATE INDEX IF NOT EXISTS lot_usages_reposicion_idx ON public.lot_usages(reposicion_id);

CREATE OR REPLACE FUNCTION public.record_machine_service(
  p_visit_uuid UUID,
  p_machine_id UUID,
  p_operator_id UUID,
  p_device_event_time TIMESTAMPTZ,
  p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER,
  p_refill_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine RECORD;
  v_tenant_id UUID;
  v_has_cleaning BOOLEAN := p_cleaning_material_used IS NOT NULL OR p_water_bucket_count IS NOT NULL;
  v_has_refill BOOLEAN := jsonb_typeof(p_refill_lines) = 'array' AND jsonb_array_length(p_refill_lines) > 0;
  v_clean RECORD;
  v_refill RECORD;
  v_refill_id UUID;
  v_refill_inserted BOOLEAN := FALSE;
  v_payload JSONB;
  v_line JSONB;
  v_lot RECORD;
  v_quantity DOUBLE PRECISION;
  v_pending DOUBLE PRECISION;
BEGIN
  IF NOT v_has_cleaning AND NOT v_has_refill THEN RAISE EXCEPTION 'Select cleaning, refill, or both'; END IF;
  IF v_has_cleaning AND (p_cleaning_material_used IS NULL OR p_water_bucket_count IS NULL OR p_water_bucket_count NOT BETWEEN 0 AND 20) THEN
    RAISE EXCEPTION 'Cleaning confirmation and water bucket count are required';
  END IF;
  IF v_has_refill AND jsonb_array_length(p_refill_lines) > 20 THEN RAISE EXCEPTION 'Too many refill lines'; END IF;

  SELECT id, name, device_imei, tenant_id, odoo_warehouse_id
  INTO v_machine FROM public.machines WHERE id = p_machine_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;

  SELECT a.tenant_id INTO v_tenant_id FROM public.machine_franchisee_assignments a
  WHERE a.machine_id = p_machine_id
    AND a.start_date <= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
    AND (a.end_date IS NULL OR a.end_date >= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
  ORDER BY a.start_date DESC LIMIT 1;
  v_tenant_id := COALESCE(v_tenant_id, v_machine.tenant_id);

  IF v_has_cleaning THEN
    SELECT machine_id, operator_id, kind, device_event_time, cleaning_material_used, water_bucket_count
    INTO v_clean FROM public.clean_logs WHERE client_uuid = p_visit_uuid;
    IF FOUND THEN
      IF v_clean.machine_id IS DISTINCT FROM p_machine_id
        OR v_clean.operator_id IS DISTINCT FROM p_operator_id
        OR v_clean.kind IS DISTINCT FROM 'full'
        OR v_clean.device_event_time IS DISTINCT FROM p_device_event_time
        OR v_clean.cleaning_material_used IS DISTINCT FROM p_cleaning_material_used
        OR v_clean.water_bucket_count IS DISTINCT FROM p_water_bucket_count THEN
        RAISE EXCEPTION 'Service visit UUID conflicts with another cleaning event';
      END IF;
    ELSE
      INSERT INTO public.clean_logs (
        tenant_id, client_uuid, machine_id, operator_id, kind, device_event_time,
        cleaning_material_used, water_bucket_count, odoo_sync_status
      ) VALUES (
        v_tenant_id, p_visit_uuid, p_machine_id, p_operator_id, 'full', p_device_event_time,
        p_cleaning_material_used, p_water_bucket_count, 'pending'
      );
      UPDATE public.machines
      SET last_full_clean_date = GREATEST(COALESCE(last_full_clean_date, p_device_event_time), p_device_event_time)
      WHERE id = p_machine_id;
    END IF;
  END IF;

  IF v_has_refill THEN
    IF v_machine.odoo_warehouse_id IS NULL THEN RAISE EXCEPTION 'Machine has no warehouse assigned'; END IF;
    v_payload := jsonb_build_object(
      'visit_uuid', p_visit_uuid,
      'source', 'machine_qr',
      'machine_id', p_machine_id,
      'operator_id', p_operator_id,
      'device_event_time', p_device_event_time,
      'odoo_warehouse_id', v_machine.odoo_warehouse_id,
      'lines', p_refill_lines
    );

    INSERT INTO public.reposiciones (
      tenant_id, client_uuid, machine_id, operator_id, device_event_time,
      payload_json, status, synced_at, odoo_sync_status
    ) VALUES (
      v_tenant_id, p_visit_uuid, p_machine_id, p_operator_id, p_device_event_time,
      v_payload, 'synced', now(), 'pending'
    )
    ON CONFLICT (client_uuid) DO NOTHING
    RETURNING id INTO v_refill_id;
    v_refill_inserted := v_refill_id IS NOT NULL;

    IF NOT v_refill_inserted THEN
      SELECT id, machine_id, operator_id, device_event_time, payload_json
      INTO v_refill FROM public.reposiciones WHERE client_uuid = p_visit_uuid;
      IF v_refill.machine_id IS DISTINCT FROM p_machine_id
        OR v_refill.operator_id IS DISTINCT FROM p_operator_id
        OR v_refill.device_event_time IS DISTINCT FROM p_device_event_time
        OR v_refill.payload_json IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'Service visit UUID conflicts with another refill event';
      END IF;
      v_refill_id := v_refill.id;
    END IF;

    IF v_refill_inserted THEN
      FOR v_line IN SELECT value FROM jsonb_array_elements(p_refill_lines) LOOP
        IF COALESCE(v_line->>'odoo_lot_id', '') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Valid lot ID is required'; END IF;
        v_quantity := NULLIF(v_line->>'quantity_used', '')::DOUBLE PRECISION;
        IF v_quantity IS NULL OR v_quantity <= 0 THEN RAISE EXCEPTION 'Refill quantity must be positive'; END IF;

        SELECT odoo_id, name, odoo_product_id, product_name, qty, odoo_warehouse_id
        INTO v_lot FROM public.odoo_lots WHERE odoo_id = (v_line->>'odoo_lot_id')::INTEGER FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Lot not found'; END IF;
        IF v_lot.odoo_warehouse_id IS DISTINCT FROM v_machine.odoo_warehouse_id THEN RAISE EXCEPTION 'Lot is not in this machine warehouse'; END IF;

        SELECT COALESCE(SUM(lu.quantity), 0) INTO v_pending
        FROM public.lot_usages lu
        JOIN public.reposiciones r ON r.id = lu.reposicion_id
        WHERE lu.odoo_lot_id = v_lot.odoo_id AND r.odoo_sync_status IN ('pending', 'failed');
        IF COALESCE(v_lot.qty, 0) - v_pending < v_quantity THEN RAISE EXCEPTION 'Insufficient lot quantity'; END IF;

        INSERT INTO public.lot_usages (
          machine_id, machine_name, device_imei, product_name, product_type, lot_name,
          quantity, operator_id, device_event_time, odoo_lot_id, reposicion_id
        ) VALUES (
          p_machine_id, v_machine.name, v_machine.device_imei, v_lot.product_name, 'unknown', v_lot.name,
          v_quantity, p_operator_id::TEXT, p_device_event_time, v_lot.odoo_id, v_refill_id
        );
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('visit_uuid', p_visit_uuid, 'cleaning', v_has_cleaning, 'refill', v_has_refill);
END;
$$;

REVOKE ALL ON FUNCTION public.record_machine_service(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_machine_service(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, INTEGER, JSONB) TO service_role;
