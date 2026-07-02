alter table public.products add column if not exists price double precision default 0;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists allergen_url text;

insert into storage.buckets (id, name, public)
values ('product-media', 'product-media', true)
on conflict (id) do nothing;
