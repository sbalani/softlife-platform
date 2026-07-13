-- machines.location has been synced from Huaxin all along, but v_machines
-- never selected it — the machines list rendered customer under a
-- "Location" header instead (empty until a machine gets a customer).
-- Drop + recreate: "create or replace view" can't insert a column mid-order.
drop view if exists public.v_machines;
create view public.v_machines as
select
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at,
  m.location,
  m.is_online as net_online,
  cust.name   as customer,
  wh.name     as warehouse,
  prod.name   as base_product,
  (select count(*) from public.machine_ingredients mi where mi.machine_id = m.id) as ingredient_count,
  (select t.value from public.huaxin_temperatures t
     where t.machine_id = m.id order by t.reading_time desc limit 1) as latest_temp
from public.machines m
  left join public.tenants    cust on cust.id = m.customer_id
  left join public.warehouses wh   on wh.id   = m.warehouse_id
  left join public.products   prod on prod.id = m.base_product_id;
