CREATE OR REPLACE FUNCTION public.claim_warehouse_transfers(p_worker TEXT, p_limit INTEGER DEFAULT 20)
RETURNS TABLE(movement_id UUID, movement_group_id UUID, lease_token UUID, external_reference TEXT, movement_kind TEXT, odoo_warehouse_id INTEGER, odoo_lot_id INTEGER, quantity NUMERIC, occurred_at TIMESTAMPTZ, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(p_worker), '') IS NULL THEN RAISE EXCEPTION 'Worker lease token is required'; END IF;
  PERFORM pg_advisory_xact_lock(814732);
  RETURN QUERY
  WITH operations AS (
    SELECT movement.movement_group_id AS operation_id, MIN(sync.updated_at) AS queued_at,
      gen_random_uuid() AS lease_token
    FROM public.warehouse_stock_movement_sync sync
    JOIN public.warehouse_stock_movements movement ON movement.id = sync.movement_id
    WHERE movement.movement_group_id IS NOT NULL
      AND movement.movement_kind IN ('transfer_out', 'transfer_in')
    GROUP BY movement.movement_group_id
    HAVING COUNT(*) = 2
      AND COUNT(*) FILTER (WHERE movement.movement_kind = 'transfer_out') = 1
      AND COUNT(*) FILTER (WHERE movement.movement_kind = 'transfer_in') = 1
      AND bool_and(
        (sync.status IN ('pending', 'retry_wait') AND (sync.next_attempt_at IS NULL OR sync.next_attempt_at <= now()))
        OR (sync.status = 'processing' AND (sync.lease_expires_at IS NULL OR sync.lease_expires_at < now()))
      )
    ORDER BY MIN(sync.updated_at), movement.movement_group_id
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ), updated AS (
    UPDATE public.warehouse_stock_movement_sync sync SET status = 'processing', lease_owner = p_worker,
      lease_token = operations.lease_token,
      lease_expires_at = now() + INTERVAL '5 minutes', attempt_count = attempt_count + 1,
      last_attempt_at = now(), updated_at = now()
    FROM public.warehouse_stock_movements movement, operations
    WHERE sync.movement_id = movement.id AND movement.movement_group_id = operations.operation_id
      AND (
        (sync.status IN ('pending', 'retry_wait') AND (sync.next_attempt_at IS NULL OR sync.next_attempt_at <= now()))
        OR (sync.status = 'processing' AND (sync.lease_expires_at IS NULL OR sync.lease_expires_at < now()))
      )
    RETURNING sync.movement_id, sync.lease_token, sync.external_reference
  )
  SELECT movement.id, movement.movement_group_id, updated.lease_token, updated.external_reference, movement.movement_kind,
    movement.odoo_warehouse_id, movement.odoo_lot_id, movement.quantity, movement.occurred_at, movement.reason
  FROM updated JOIN public.warehouse_stock_movements movement ON movement.id = updated.movement_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.claim_warehouse_stock_movements(TEXT, INTEGER) FROM service_role;

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
    RETURN jsonb_build_object('out_movement_id', v_out.id, 'in_movement_id', v_in.id, 'created', false);
  END IF;
  IF p_client_uuid IS NULL OR p_actor_id IS NULL OR p_occurred_at IS NULL OR p_source_warehouse_id = p_destination_warehouse_id OR p_quantity <= 0 OR NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Valid distinct warehouses, quantity, actor, time, and reason are required'; END IF;
  SELECT effective_quantity INTO v_available FROM public.warehouse_lot_effective_balances WHERE odoo_warehouse_id = p_source_warehouse_id AND odoo_lot_id = p_odoo_lot_id;
  IF COALESCE(v_available, 0) < p_quantity THEN RAISE EXCEPTION 'Transfer exceeds effective source stock'; END IF;
  INSERT INTO public.warehouse_stock_movements(client_uuid, movement_group_id, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind, reference, occurred_at, created_by, reason)
    VALUES (gen_random_uuid(), p_client_uuid, p_source_warehouse_id, p_odoo_lot_id, -p_quantity, 'transfer_out', 'Platform transfer ' || p_client_uuid, p_occurred_at, p_actor_id, btrim(p_reason)) RETURNING * INTO v_out;
  INSERT INTO public.warehouse_stock_movements(client_uuid, movement_group_id, odoo_warehouse_id, odoo_lot_id, quantity, movement_kind, reference, occurred_at, created_by, reason)
    VALUES (gen_random_uuid(), p_client_uuid, p_destination_warehouse_id, p_odoo_lot_id, p_quantity, 'transfer_in', 'Platform transfer ' || p_client_uuid, p_occurred_at, p_actor_id, btrim(p_reason)) RETURNING * INTO v_in;
  INSERT INTO public.warehouse_stock_movement_sync(movement_id, external_reference) VALUES (v_out.id, 'softlife-transfer:' || p_client_uuid || ':out'), (v_in.id, 'softlife-transfer:' || p_client_uuid || ':in');
  RETURN jsonb_build_object('out_movement_id', v_out.id, 'in_movement_id', v_in.id, 'created', true);
END; $$;
