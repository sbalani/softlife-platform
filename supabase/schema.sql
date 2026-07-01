-- ============================================================================
-- SoftLife Platform — Supabase schema (multi-tenant)
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
-- ============================================================================

-- ---------- helpers ----------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

-- ---------- tenants (franchisees + internal) --------------------------------
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'franchisee',  -- franchisee | internal
  created_at  timestamptz not null default now()
);

-- ---------- user profiles (1:1 with auth.users) -----------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid references public.tenants(id) on delete set null,
  role        text not null default 'operator',  -- admin | operator | franchisee
  full_name   text,
  created_at  timestamptz not null default now()
);

-- ---------- warehouses & products -------------------------------------------
create table if not exists public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  type        text not null default 'topping'  -- base | topping | sauce
);

-- ---------- machines --------------------------------------------------------
create table if not exists public.machines (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references public.tenants(id) on delete set null,
  name                 text not null,
  ref                  text,
  device_imei          text unique,
  device_id_huaxin     text,
  customer_id          uuid references public.tenants(id) on delete set null,
  warehouse_id         uuid references public.warehouses(id) on delete set null,
  base_product_id      uuid references public.products(id) on delete set null,
  location             text,
  state                text not null default 'active',  -- active | in_transit | stored | retired
  last_full_clean_date timestamptz,
  huaxin_last_sync     timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists machines_tenant_idx on public.machines(tenant_id);
create index if not exists machines_customer_idx on public.machines(customer_id);

create table if not exists public.machine_ingredients (
  id              uuid primary key default gen_random_uuid(),
  machine_id      uuid not null references public.machines(id) on delete cascade,
  position        text not null,
  product_id      uuid references public.products(id) on delete set null,
  product_type    text default 'topping',
  enabled         boolean default true,
  cycled          boolean default false,
  portion_size    double precision,
  loaded_capacity double precision
);

create table if not exists public.machine_transfers (
  id              uuid primary key default gen_random_uuid(),
  machine_id      uuid not null references public.machines(id) on delete cascade,
  name            text,
  date            timestamptz not null default now(),
  from_tenant_id  uuid references public.tenants(id),
  to_tenant_id    uuid references public.tenants(id),
  from_location   text,
  to_location     text,
  note            text
);

-- ---------- HACCP / inventory -----------------------------------------------
create table if not exists public.lots (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  name               text not null,
  product_id         uuid references public.products(id) on delete set null,
  product_name       text,
  qty_available      double precision default 0,
  device_event_time  timestamptz,
  disposition        text default 'released'  -- released | hold | dispose
);

create table if not exists public.reposiciones (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  client_uuid       uuid not null unique,           -- idempotency (offline queue)
  machine_id        uuid references public.machines(id) on delete set null,
  operator_id       uuid,
  device_event_time timestamptz not null,
  status            text not null default 'pending', -- pending | synced | failed
  payload_json      jsonb,
  created_at        timestamptz not null default now(),
  synced_at         timestamptz,
  last_error        text
);

create table if not exists public.clean_logs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  client_uuid       uuid not null unique,
  machine_id        uuid not null references public.machines(id) on delete cascade,
  operator_id       uuid,
  kind              text not null default 'full',  -- full | partial
  device_event_time timestamptz not null
);

create table if not exists public.alerts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  type          text not null,        -- machine_refill | warehouse_restock | recall | calibration
  severity      text default 'info',  -- info | warning | critical
  machine_id    uuid references public.machines(id) on delete cascade,
  message       text not null,
  remaining_pct double precision,
  created_at    timestamptz not null default now()
);

-- ---------- Huaxin telemetry (ingested server-side) ------------------------
create table if not exists public.huaxin_temperatures (
  id           uuid primary key default gen_random_uuid(),
  machine_id   uuid references public.machines(id) on delete cascade,
  reading_time timestamptz not null,
  series_name  text,
  value        double precision,
  raw          text
);
create index if not exists htemp_machine_time_idx on public.huaxin_temperatures(machine_id, reading_time desc);

create table if not exists public.huaxin_orders (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete set null,
  machine_id   uuid references public.machines(id) on delete set null,
  device_imei  text,
  order_code   text unique,
  out_trade_no text,
  order_state  text,
  order_time   timestamptz,
  price        double precision,
  amount       double precision,
  product_name text,
  detail_raw   text,
  raw          text
);

create table if not exists public.huaxin_faults (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid references public.machines(id) on delete set null,
  device_id_huaxin text,
  subject          text,
  html_body        text,
  received_at      timestamptz not null default now(),
  state            text default 'new',  -- new | acknowledged | resolved
  raw              text
);

-- ---------- dashboard view --------------------------------------------------
create or replace view public.v_machines as
select
  m.id, m.name, m.ref, m.device_imei, m.state, m.last_full_clean_date,
  m.created_at,
  (m.huaxin_last_sync is not null and m.huaxin_last_sync > now() - interval '2 hours') as net_online,
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

create or replace view public.v_orders as
select o.id, o.order_time, o.order_code, o.order_state, o.price, o.amount,
       o.product_name, o.device_imei, m.name as machine_name
from public.huaxin_orders o
  left join public.machines m on m.id = o.machine_id;

create or replace view public.v_alerts as
select a.id, a.type, a.severity, a.message, a.remaining_pct, a.created_at,
       m.name as machine_name
from public.alerts a
  left join public.machines m on m.id = a.machine_id;

create or replace view public.v_latest_temps as
select distinct on (m.id)
       m.id as machine_id, m.name as machine_name,
       t.reading_time, t.series_name, t.value
from public.machines m
  left join public.huaxin_temperatures t on t.machine_id = m.id
order by m.id, t.reading_time desc nulls last;

-- ============================================================================
-- Row Level Security: each tenant sees only their rows; admins see all.
-- (Service-role key used by the Huaxin sync/webhook bypasses RLS.)
-- ============================================================================
alter table public.machines            enable row level security;
alter table public.warehouses          enable row level security;
alter table public.products            enable row level security;
alter table public.machine_ingredients enable row level security;
alter table public.machine_transfers   enable row level security;
alter table public.lots                enable row level security;
alter table public.reposiciones        enable row level security;
alter table public.clean_logs          enable row level security;
alter table public.alerts              enable row level security;
alter table public.huaxin_orders       enable row level security;
alter table public.huaxin_temperatures enable row level security;
alter table public.huaxin_faults       enable row level security;

create or replace function public.is_current_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Helper to apply the standard tenant policy to a table.
do $$
declare t text;
begin
  foreach t in array array[
    'machines','warehouses','products','machine_transfers',
    'lots','reposiciones','clean_logs','alerts','huaxin_orders'
  ]
  loop
    execute format($f$
      drop policy if exists tenant_isolation on public.%I;
      create policy tenant_isolation on public.%I
        using (tenant_id = public.current_tenant_id() or public.is_current_admin())
        with check (tenant_id = public.current_tenant_id() or public.is_current_admin());
    $f$, t, t);
  end loop;
end $$;

-- Machine-child tables: visible if the parent machine belongs to the tenant.
drop policy if exists mi_isolation on public.machine_ingredients;
create policy mi_isolation on public.machine_ingredients
  using (exists (
    select 1 from public.machines m
    where m.id = machine_ingredients.machine_id
      and (m.tenant_id = public.current_tenant_id() or public.is_current_admin())
  ));

-- Telemetry tied to a machine: same rule.
drop policy if exists ht_isolation on public.huaxin_temperatures;
create policy ht_isolation on public.huaxin_temperatures
  using (machine_id is null or exists (
    select 1 from public.machines m
    where m.id = huaxin_temperatures.machine_id
      and (m.tenant_id = public.current_tenant_id() or public.is_current_admin())
  ));
drop policy if exists hf_isolation on public.huaxin_faults;
create policy hf_isolation on public.huaxin_faults
  using (machine_id is null or exists (
    select 1 from public.machines m
    where m.id = huaxin_faults.machine_id
      and (m.tenant_id = public.current_tenant_id() or public.is_current_admin())
  ));

-- ---------- auto-create profile on signup ----------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
