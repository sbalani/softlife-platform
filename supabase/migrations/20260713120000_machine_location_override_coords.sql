-- Manual location override (survives Huaxin syncs, which keep refreshing the
-- detected `location`) + geocoded coordinates for map views.
alter table public.machines add column if not exists location_override text;
alter table public.machines add column if not exists latitude double precision;
alter table public.machines add column if not exists longitude double precision;
-- What the coordinates were geocoded from — lets the sync re-geocode only
-- when the effective address actually changed.
alter table public.machines add column if not exists geocoded_from text;

drop view if exists public.v_machines;
create view public.v_machines as
select
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at,
  m.location,
  m.location_override,
  m.latitude,
  m.longitude,
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
