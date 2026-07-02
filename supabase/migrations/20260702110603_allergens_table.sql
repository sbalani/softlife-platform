create table if not exists public.allergens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  logo_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.ingredient_allergens (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.products(id) on delete cascade,
  allergen_id uuid not null references public.allergens(id) on delete cascade,
  presence text not null default 'contains',
  unique (ingredient_id, allergen_id, presence)
);

insert into public.allergens (name, slug) values
  ('Gluten','gluten'), ('Crustaceans','crustaceans'), ('Eggs','eggs'), ('Fish','fish'),
  ('Peanuts','peanuts'), ('Soybeans','soy'), ('Milk','milk'), ('Tree nuts','tree-nuts'),
  ('Celery','celery'), ('Mustard','mustard'), ('Sesame','sesame'), ('Sulphites','sulphites'),
  ('Lupin','lupin'), ('Molluscs','molluscs')
on conflict (slug) do nothing;

alter table public.allergens enable row level security;
alter table public.ingredient_allergens enable row level security;
create policy allergens_read on public.allergens for select using (true);
create policy ia_read on public.ingredient_allergens for select using (true);
