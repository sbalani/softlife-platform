UPDATE public.reposiciones
SET odoo_sync_status = 'not_required'
WHERE COALESCE(payload_json->>'source', '') <> 'machine_qr';

ALTER TABLE public.reposiciones ALTER COLUMN odoo_sync_status SET DEFAULT 'not_required';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.lot_usages lu
    LEFT JOIN public.odoo_lots l ON l.odoo_id = lu.odoo_lot_id
    WHERE lu.odoo_lot_id IS NOT NULL AND l.odoo_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot constrain orphan Odoo lot usage rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_usages_odoo_lot_id_fkey') THEN
    ALTER TABLE public.lot_usages ADD CONSTRAINT lot_usages_odoo_lot_id_fkey
      FOREIGN KEY (odoo_lot_id) REFERENCES public.odoo_lots(odoo_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.serialize_clean_log_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_uuid::TEXT, 0));
  SELECT machine_id, operator_id, kind, device_event_time, cleaning_material_used, water_bucket_count
  INTO v_existing FROM public.clean_logs WHERE client_uuid = NEW.client_uuid;
  IF FOUND THEN
    IF v_existing.machine_id IS DISTINCT FROM NEW.machine_id
      OR v_existing.operator_id IS DISTINCT FROM NEW.operator_id
      OR v_existing.kind IS DISTINCT FROM NEW.kind
      OR v_existing.device_event_time IS DISTINCT FROM NEW.device_event_time
      OR v_existing.cleaning_material_used IS DISTINCT FROM NEW.cleaning_material_used
      OR v_existing.water_bucket_count IS DISTINCT FROM NEW.water_bucket_count THEN
      RAISE EXCEPTION 'Cleaning client UUID conflicts with another event';
    END IF;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clean_logs_serialize_insert ON public.clean_logs;
CREATE TRIGGER clean_logs_serialize_insert
BEFORE INSERT ON public.clean_logs
FOR EACH ROW EXECUTE FUNCTION public.serialize_clean_log_insert();

CREATE OR REPLACE FUNCTION public.lock_machine_service_warehouse()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_warehouse_id INTEGER;
BEGIN
  IF COALESCE(NEW.payload_json->>'source', '') = 'machine_qr' THEN
    SELECT odoo_warehouse_id INTO v_warehouse_id
    FROM public.machines WHERE id = NEW.machine_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
    IF v_warehouse_id IS DISTINCT FROM (NEW.payload_json->>'odoo_warehouse_id')::INTEGER THEN
      RAISE EXCEPTION 'Machine warehouse changed during service visit';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reposiciones_lock_service_warehouse ON public.reposiciones;
CREATE TRIGGER reposiciones_lock_service_warehouse
BEFORE INSERT ON public.reposiciones
FOR EACH ROW EXECUTE FUNCTION public.lock_machine_service_warehouse();
