CREATE OR REPLACE FUNCTION public.track_machine_warehouse_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.odoo_warehouse_id IS NOT DISTINCT FROM OLD.odoo_warehouse_id THEN RETURN NEW; END IF;
  IF NEW.odoo_warehouse_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.machine_warehouse_assignments
    WHERE machine_id = NEW.id AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
  ) THEN RETURN NEW; END IF;
  IF NEW.odoo_warehouse_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.machine_warehouse_assignments
    WHERE machine_id = NEW.id AND odoo_warehouse_id = NEW.odoo_warehouse_id
      AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
  ) THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION public.set_machine_warehouse_assignment_period(
  p_machine_id UUID,
  p_odoo_warehouse_id INTEGER,
  p_valid_from TIMESTAMPTZ,
  p_valid_to TIMESTAMPTZ,
  p_actor_id UUID
)
RETURNS public.machine_warehouse_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role TEXT;
  v_assignment public.machine_warehouse_assignments%ROWTYPE;
  v_existing public.machine_warehouse_assignments%ROWTYPE;
  v_current_warehouse INTEGER;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = p_actor_id;
  IF v_actor_role <> 'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_valid_from IS NULL OR (p_valid_to IS NOT NULL AND p_valid_to <= p_valid_from) THEN RAISE EXCEPTION 'Invalid assignment period'; END IF;
  IF p_valid_from > now() OR (p_valid_to IS NOT NULL AND p_valid_to > now()) THEN
    RAISE EXCEPTION 'Assignment periods cannot start or end in the future';
  END IF;
  PERFORM 1 FROM public.machines WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.odoo_warehouses WHERE odoo_id = p_odoo_warehouse_id) THEN RAISE EXCEPTION 'Warehouse not found'; END IF;

  PERFORM 1 FROM public.huaxin_orders
  WHERE machine_id = p_machine_id
  ORDER BY id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.huaxin_orders order_row
    JOIN public.manufacturing_period_export_orders membership ON membership.order_id = order_row.id AND membership.released_at IS NULL
    WHERE order_row.machine_id = p_machine_id AND order_row.order_time >= p_valid_from
      AND (p_valid_to IS NULL OR order_row.order_time < p_valid_to)
  ) THEN RAISE EXCEPTION 'Orders in this period belong to an active manufacturing run'; END IF;

  FOR v_existing IN
    SELECT * FROM public.machine_warehouse_assignments assignment
    WHERE assignment.machine_id = p_machine_id
      AND tstzrange(assignment.valid_from, COALESCE(assignment.valid_to, 'infinity'::timestamptz), '[)')
        && tstzrange(p_valid_from, COALESCE(p_valid_to, 'infinity'::timestamptz), '[)')
    ORDER BY assignment.valid_from
    FOR UPDATE
  LOOP
    UPDATE public.huaxin_orders
      SET warehouse_assignment_id = NULL, odoo_warehouse_id_at_sale = NULL
      WHERE warehouse_assignment_id = v_existing.id;
    DELETE FROM public.machine_warehouse_assignments WHERE id = v_existing.id;
    IF v_existing.valid_from < p_valid_from THEN
      INSERT INTO public.machine_warehouse_assignments(machine_id, odoo_warehouse_id, valid_from, valid_to)
        VALUES (p_machine_id, v_existing.odoo_warehouse_id, v_existing.valid_from, p_valid_from);
    END IF;
    IF p_valid_to IS NOT NULL AND (v_existing.valid_to IS NULL OR v_existing.valid_to > p_valid_to) THEN
      INSERT INTO public.machine_warehouse_assignments(machine_id, odoo_warehouse_id, valid_from, valid_to)
        VALUES (p_machine_id, v_existing.odoo_warehouse_id, p_valid_to, v_existing.valid_to);
    END IF;
  END LOOP;

  INSERT INTO public.machine_warehouse_assignments(machine_id, odoo_warehouse_id, valid_from, valid_to)
    VALUES (p_machine_id, p_odoo_warehouse_id, p_valid_from, p_valid_to)
    RETURNING * INTO v_assignment;

  SELECT assignment.odoo_warehouse_id INTO v_current_warehouse
  FROM public.machine_warehouse_assignments assignment
  WHERE assignment.machine_id = p_machine_id AND assignment.valid_from <= now()
    AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
  ORDER BY assignment.valid_from DESC LIMIT 1;
  UPDATE public.machines SET odoo_warehouse_id = v_current_warehouse WHERE id = p_machine_id;

  UPDATE public.huaxin_orders SET order_time = order_time WHERE machine_id = p_machine_id;
  RETURN v_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.track_machine_warehouse_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_machine_warehouse_assignment_period(UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_machine_warehouse_assignment_period(UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO service_role;
