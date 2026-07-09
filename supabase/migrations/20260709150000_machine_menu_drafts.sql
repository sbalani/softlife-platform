-- Snapshot of a source machine's live menu, queued for review + push onto
-- one or more target machines. Populated by "Copy this menu to other
-- machines"; a target machine shows it as a pending draft until pushed or
-- dismissed. Only captures what Huaxin's read API actually returns
-- (goodsName/price/imagePath/marketPrice/stock) — allergyPath isn't exposed
-- on read, so copied items don't carry an allergen image; that regenerates
-- on the target via the normal per-item / solid-toppings push flows.
create table if not exists public.machine_menu_drafts (
  id                   uuid primary key default gen_random_uuid(),
  machine_id           uuid not null references public.machines(id) on delete cascade,
  source_machine_id    uuid references public.machines(id) on delete set null,
  source_machine_name  text,
  items                jsonb not null,
  created_at           timestamptz not null default now(),
  applied_at           timestamptz
);
create index if not exists machine_menu_drafts_pending_idx on public.machine_menu_drafts(machine_id) where applied_at is null;

alter table public.machine_menu_drafts enable row level security;
create policy machine_menu_drafts_read on public.machine_menu_drafts for select using (true);
