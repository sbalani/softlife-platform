-- Store actual online status from Huaxin (not computed from sync time)
alter table public.machines add column if not exists is_online boolean default false;

-- Update v_machines to use the stored field
create or replace view public.v_machines as
select
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at,
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
