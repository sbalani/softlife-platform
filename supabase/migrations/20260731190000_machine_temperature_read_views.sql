CREATE OR REPLACE VIEW public.v_machines
WITH (security_invoker = true)
AS
SELECT
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at, m.location, m.location_override, m.latitude, m.longitude,
  m.is_online AS net_online,
  cust.name AS customer,
  wh.name AS warehouse,
  prod.name AS base_product,
  (SELECT count(*) FROM public.machine_ingredients mi WHERE mi.machine_id = m.id) AS ingredient_count,
  (SELECT t.value FROM public.huaxin_temperatures t WHERE t.machine_id = m.id ORDER BY t.reading_time DESC, t.id DESC LIMIT 1) AS latest_temp,
  m.huaxin_last_sync
FROM public.machines m
LEFT JOIN public.tenants cust ON cust.id = m.customer_id
LEFT JOIN public.warehouses wh ON wh.id = m.warehouse_id
LEFT JOIN public.products prod ON prod.id = m.base_product_id;

CREATE OR REPLACE VIEW public.v_latest_temps
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (m.id, t.series_name)
  m.id AS machine_id,
  m.name AS machine_name,
  t.reading_time,
  t.series_name,
  t.value
FROM public.machines m
JOIN public.huaxin_temperatures t ON t.machine_id = m.id
ORDER BY m.id, t.series_name, t.reading_time DESC, t.id DESC;

CREATE INDEX IF NOT EXISTS htemp_machine_series_time_idx
  ON public.huaxin_temperatures (machine_id, series_name, reading_time DESC);

DROP POLICY IF EXISTS ht_isolation ON public.huaxin_temperatures;
CREATE POLICY ht_isolation ON public.huaxin_temperatures
USING (EXISTS (
  SELECT 1 FROM public.machines m
  WHERE m.id = huaxin_temperatures.machine_id
    AND (m.tenant_id = public.current_tenant_id() OR public.is_current_admin())
));

GRANT SELECT ON public.v_machines, public.v_latest_temps TO authenticated;
