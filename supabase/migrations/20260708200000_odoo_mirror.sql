-- Odoo master-data mirror. Written by softlife_sync's cron (Odoo -> Supabase);
-- the platform only ever reads these, same as every other data source here.
create table if not exists public.odoo_warehouses (
  odoo_id     integer primary key,
  name        text not null,
  code        text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.odoo_products (
  odoo_id        integer primary key,
  name           text not null,
  sku            text,
  barcode        text,
  category       text,
  uom            text,
  qty_available  double precision default 0,
  updated_at     timestamptz not null default now()
);

create table if not exists public.odoo_lots (
  odoo_id            integer primary key,
  name               text not null,
  odoo_product_id    integer references public.odoo_products(odoo_id) on delete set null,
  product_name       text,
  qty                double precision default 0,
  expiration_date    date,
  odoo_warehouse_id  integer references public.odoo_warehouses(odoo_id) on delete set null,
  warehouse_name     text,
  updated_at         timestamptz not null default now()
);
create index if not exists odoo_lots_product_idx on public.odoo_lots(odoo_product_id);

-- Links the platform's own ingredient catalog to its Odoo counterpart.
-- Null = not yet pushed to Odoo; softlife_sync creates the Odoo record on its
-- next run and writes the resulting id back here.
alter table public.products add column if not exists odoo_id integer references public.odoo_products(odoo_id) on delete set null;

alter table public.odoo_warehouses enable row level security;
alter table public.odoo_products   enable row level security;
alter table public.odoo_lots       enable row level security;
create policy odoo_warehouses_read on public.odoo_warehouses for select using (true);
create policy odoo_products_read   on public.odoo_products   for select using (true);
create policy odoo_lots_read       on public.odoo_lots       for select using (true);
