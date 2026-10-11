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
WHERE t.reading_time <= now() + INTERVAL '5 minutes'
ORDER BY m.id, t.series_name, t.reading_time DESC, t.id DESC;

CREATE OR REPLACE VIEW public.v_machines
WITH (security_invoker = true)
AS
SELECT
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at, m.location, m.location_override, m.latitude, m.longitude,
  m.is_online AS net_online, cust.name AS customer, wh.name AS warehouse,
  prod.name AS base_product,
  (SELECT count(*) FROM public.machine_ingredients mi WHERE mi.machine_id = m.id) AS ingredient_count,
  (SELECT t.value FROM public.huaxin_temperatures t WHERE t.machine_id = m.id AND t.reading_time <= now() + INTERVAL '5 minutes' ORDER BY t.reading_time DESC, t.id DESC LIMIT 1) AS latest_temp,
  m.huaxin_last_sync, m.deployed, m.last_online_at, m.offline_since
FROM public.machines m
LEFT JOIN public.tenants cust ON cust.id = m.customer_id
LEFT JOIN public.warehouses wh ON wh.id = m.warehouse_id
LEFT JOIN public.products prod ON prod.id = m.base_product_id;

GRANT SELECT ON public.v_machines, public.v_latest_temps TO authenticated;
