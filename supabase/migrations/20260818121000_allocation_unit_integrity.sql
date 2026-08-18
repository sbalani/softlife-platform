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
  SELECT line.quantity, line.unit, report.status INTO v_line_quantity, v_line_unit, v_report_status
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
  IF v_allocated + NEW.quantity > v_line_quantity THEN RAISE EXCEPTION 'Allocations exceed the physical refill quantity'; END IF;
  SELECT effective_quantity INTO v_available FROM public.warehouse_lot_effective_balances
    WHERE odoo_warehouse_id = NEW.odoo_warehouse_id AND odoo_lot_id = NEW.odoo_lot_id;
  IF COALESCE(v_available, 0) < NEW.stock_quantity THEN RAISE EXCEPTION 'Allocation exceeds effective warehouse stock'; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_refill_stock_allocation() FROM PUBLIC, anon, authenticated;
