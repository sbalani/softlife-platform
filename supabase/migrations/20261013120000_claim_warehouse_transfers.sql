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
    RETURNING sync.movement_id, sync.lease_token, sync.external_reference
  )
  SELECT movement.id, movement.movement_group_id, updated.lease_token, updated.external_reference, movement.movement_kind,
    movement.odoo_warehouse_id, movement.odoo_lot_id, movement.quantity, movement.occurred_at, movement.reason
  FROM updated JOIN public.warehouse_stock_movements movement ON movement.id = updated.movement_id;
END; $$;

REVOKE ALL ON FUNCTION public.claim_warehouse_transfers(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_warehouse_transfers(TEXT, INTEGER) TO service_role;
