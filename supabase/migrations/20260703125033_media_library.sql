create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  name text,
  type text default 'image',
  duration integer default 60,
  created_at timestamptz not null default now()
);
alter table public.media enable row level security;
create policy media_read on public.media for select using (true);
