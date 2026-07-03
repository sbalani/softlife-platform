-- Lot usage audit log (every lot loaded into a machine hopper)
create table if not exists public.lot_usages (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid references public.machines(id) on delete set null,
  machine_name text,
  device_imei text,
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  product_type text default 'topping',
  lot_name text not null,
  position text,
  quantity double precision,
  operator_id text,
  device_event_time timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists lot_usages_machine_idx on public.lot_usages(machine_id);
create index if not exists lot_usages_time_idx on public.lot_usages(device_event_time desc);
create index if not exists lot_usages_lot_idx on public.lot_usages(lot_name);
create index if not exists lot_usages_product_idx on public.lot_usages(product_id);

alter table public.lot_usages enable row level security;
create policy lot_usages_read on public.lot_usages for select using (true);

-- Track current lot per hopper
alter table public.machine_ingredients add column if not exists current_lot_name text;
alter table public.machine_ingredients add column if not exists last_loaded_date timestamptz;
