ALTER TABLE public.machines
  ADD COLUMN last_online_at TIMESTAMPTZ,
  ADD COLUMN offline_since TIMESTAMPTZ;

WITH connectivity AS (
  SELECT
    machine_id,
    max(created_at) FILTER (WHERE new_value = 'true'::jsonb) AS last_online_at,
    max(created_at) FILTER (WHERE action = 'status_changed' AND new_value = 'false'::jsonb) AS offline_since
  FROM public.machine_change_log
  WHERE field = 'device_online'
    AND machine_id IS NOT NULL
  GROUP BY machine_id
)
UPDATE public.machines machine
SET
  last_online_at = connectivity.last_online_at,
  offline_since = CASE WHEN machine.is_online THEN NULL ELSE connectivity.offline_since END
FROM connectivity
WHERE connectivity.machine_id = machine.id;

CREATE FUNCTION public.track_machine_connectivity_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_online THEN
    NEW.last_online_at := now();
    NEW.offline_since := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.offline_since := COALESCE(NEW.offline_since, now());
  ELSIF OLD.is_online IS DISTINCT FROM FALSE THEN
    NEW.offline_since := COALESCE(NEW.offline_since, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER track_machine_connectivity_timestamps
BEFORE INSERT OR UPDATE OF is_online ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.track_machine_connectivity_timestamps();

CREATE OR REPLACE VIEW public.v_machines
WITH (security_invoker = true)
AS
SELECT
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at, m.location, m.location_override, m.latitude, m.longitude,
  m.is_online AS net_online, cust.name AS customer, wh.name AS warehouse,
  prod.name AS base_product,
  (SELECT count(*) FROM public.machine_ingredients mi WHERE mi.machine_id = m.id) AS ingredient_count,
  (SELECT t.value FROM public.huaxin_temperatures t WHERE t.machine_id = m.id ORDER BY t.reading_time DESC, t.id DESC LIMIT 1) AS latest_temp,
  m.huaxin_last_sync, m.deployed, m.last_online_at, m.offline_since
FROM public.machines m
LEFT JOIN public.tenants cust ON cust.id = m.customer_id
LEFT JOIN public.warehouses wh ON wh.id = m.warehouse_id
LEFT JOIN public.products prod ON prod.id = m.base_product_id;
