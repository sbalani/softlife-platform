CREATE OR REPLACE FUNCTION public.record_machine_clean(
  p_machine_id UUID,
  p_client_uuid UUID,
  p_operator_id UUID,
  p_kind TEXT,
  p_device_event_time TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_inserted BOOLEAN := FALSE;
  v_existing RECORD;
  v_last_clean TIMESTAMPTZ;
BEGIN
  IF p_kind NOT IN ('full', 'partial') THEN RAISE EXCEPTION 'Invalid cleaning kind'; END IF;

  SELECT COALESCE(assignment.tenant_id, m.tenant_id)
  INTO v_tenant_id
  FROM public.machines m
  LEFT JOIN LATERAL (
    SELECT a.tenant_id FROM public.machine_franchisee_assignments a
    WHERE a.machine_id = m.id
      AND a.start_date <= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
      AND (a.end_date IS NULL OR a.end_date >= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
    ORDER BY a.start_date DESC LIMIT 1
  ) assignment ON TRUE
  WHERE m.id = p_machine_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;

  INSERT INTO public.clean_logs (tenant_id, client_uuid, machine_id, operator_id, kind, device_event_time)
  VALUES (v_tenant_id, p_client_uuid, p_machine_id, p_operator_id, p_kind, p_device_event_time)
  ON CONFLICT (client_uuid) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  IF v_inserted IS NOT TRUE THEN
    SELECT machine_id, kind, device_event_time INTO v_existing FROM public.clean_logs WHERE client_uuid = p_client_uuid;
    IF v_existing.machine_id <> p_machine_id OR v_existing.kind <> p_kind OR v_existing.device_event_time <> p_device_event_time THEN
      RAISE EXCEPTION 'Cleaning client UUID conflicts with another event';
    END IF;
  ELSIF p_kind = 'full' THEN
    UPDATE public.machines
    SET last_full_clean_date = GREATEST(COALESCE(last_full_clean_date, p_device_event_time), p_device_event_time)
    WHERE id = p_machine_id;
  END IF;

  SELECT last_full_clean_date INTO v_last_clean FROM public.machines WHERE id = p_machine_id;
  RETURN v_last_clean;
END;
$$;

UPDATE public.clean_logs c
SET tenant_id = COALESCE(
  (SELECT a.tenant_id FROM public.machine_franchisee_assignments a
  WHERE a.machine_id = c.machine_id
    AND a.start_date <= (c.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
    AND (a.end_date IS NULL OR a.end_date >= (c.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
  ORDER BY a.start_date DESC LIMIT 1),
  (SELECT m.tenant_id FROM public.machines m WHERE m.id = c.machine_id)
)
WHERE c.tenant_id IS DISTINCT FROM COALESCE(
  (SELECT a.tenant_id FROM public.machine_franchisee_assignments a
   WHERE a.machine_id = c.machine_id
     AND a.start_date <= (c.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
     AND (a.end_date IS NULL OR a.end_date >= (c.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
   ORDER BY a.start_date DESC LIMIT 1),
  (SELECT m.tenant_id FROM public.machines m WHERE m.id = c.machine_id)
);

UPDATE public.reposiciones r
SET tenant_id = COALESCE(
  (SELECT a.tenant_id FROM public.machine_franchisee_assignments a
   WHERE a.machine_id = r.machine_id
     AND a.start_date <= (r.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
     AND (a.end_date IS NULL OR a.end_date >= (r.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
   ORDER BY a.start_date DESC LIMIT 1),
  (SELECT m.tenant_id FROM public.machines m WHERE m.id = r.machine_id)
)
WHERE r.machine_id IS NOT NULL AND r.tenant_id IS DISTINCT FROM COALESCE(
  (SELECT a.tenant_id FROM public.machine_franchisee_assignments a
   WHERE a.machine_id = r.machine_id
     AND a.start_date <= (r.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
     AND (a.end_date IS NULL OR a.end_date >= (r.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
   ORDER BY a.start_date DESC LIMIT 1),
  (SELECT m.tenant_id FROM public.machines m WHERE m.id = r.machine_id)
);

CREATE OR REPLACE FUNCTION public.record_refill(
  p_client_uuid UUID,
  p_machine_id UUID,
  p_operator_id UUID,
  p_device_event_time TIMESTAMPTZ,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_machine RECORD;
  v_tenant_id UUID;
  v_refill_id UUID;
  v_line JSONB;
  v_lot RECORD;
  v_lot_id UUID;
  v_quantity DOUBLE PRECISION;
BEGIN
  IF jsonb_typeof(p_payload->'lines') <> 'array' OR jsonb_array_length(p_payload->'lines') = 0 THEN
    RAISE EXCEPTION 'Refill requires at least one line';
  END IF;
  SELECT id, machine_id, device_event_time, payload_json INTO v_existing FROM public.reposiciones WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    IF v_existing.machine_id IS DISTINCT FROM p_machine_id OR v_existing.device_event_time IS DISTINCT FROM p_device_event_time OR v_existing.payload_json IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'Refill client UUID conflicts with another event';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT id, name, device_imei, tenant_id INTO v_machine FROM public.machines WHERE id = p_machine_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;

  SELECT a.tenant_id INTO v_tenant_id FROM public.machine_franchisee_assignments a
  WHERE a.machine_id = p_machine_id
    AND a.start_date <= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
    AND (a.end_date IS NULL OR a.end_date >= (p_device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
  ORDER BY a.start_date DESC LIMIT 1;
  v_tenant_id := COALESCE(v_tenant_id, v_machine.tenant_id);

  INSERT INTO public.reposiciones (tenant_id, client_uuid, machine_id, operator_id, device_event_time, payload_json, status, synced_at)
  VALUES (v_tenant_id, p_client_uuid, p_machine_id, p_operator_id, p_device_event_time, p_payload, 'synced', now())
  ON CONFLICT (client_uuid) DO NOTHING
  RETURNING id INTO v_refill_id;
  IF v_refill_id IS NULL THEN
    SELECT id, machine_id, device_event_time, payload_json INTO v_existing FROM public.reposiciones WHERE client_uuid = p_client_uuid;
    IF v_existing.machine_id IS DISTINCT FROM p_machine_id OR v_existing.device_event_time IS DISTINCT FROM p_device_event_time OR v_existing.payload_json IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'Refill client UUID conflicts with another event';
    END IF;
    RETURN v_existing.id;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb)) LOOP
    v_quantity := NULLIF(v_line->>'quantity_used', '')::DOUBLE PRECISION;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN RAISE EXCEPTION 'Invalid refill quantity'; END IF;
    v_lot_id := NULL;
    IF COALESCE(v_line->>'lot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      v_lot_id := (v_line->>'lot_id')::UUID;
    END IF;
    SELECT l.id, l.name, l.product_id, l.product_name, p.type AS product_type
    INTO v_lot
    FROM public.lots l LEFT JOIN public.products p ON p.id = l.product_id
    WHERE (v_tenant_id IS NULL OR l.tenant_id = v_tenant_id)
      AND ((v_lot_id IS NOT NULL AND l.id = v_lot_id) OR l.name = v_line->>'lot_name')
    ORDER BY CASE WHEN l.id = v_lot_id THEN 0 ELSE 1 END, l.device_event_time DESC NULLS LAST LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lot not found: %', COALESCE(v_line->>'lot_id', v_line->>'lot_name'); END IF;

    INSERT INTO public.lot_usages (machine_id, machine_name, device_imei, product_id, product_name, product_type, lot_name, position, quantity, operator_id, device_event_time)
    VALUES (p_machine_id, v_machine.name, v_machine.device_imei, v_lot.product_id, v_lot.product_name,
      COALESCE(v_lot.product_type, 'topping'), v_lot.name, v_line->>'position', v_quantity, p_operator_id::TEXT,
      COALESCE((v_line->>'device_event_time')::TIMESTAMPTZ, p_device_event_time));
    PERFORM public.decrement_lot_qty(v_lot.id, v_quantity);
  END LOOP;

  RETURN v_refill_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_refill(UUID, UUID, UUID, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_refill(UUID, UUID, UUID, TIMESTAMPTZ, JSONB) TO service_role;
