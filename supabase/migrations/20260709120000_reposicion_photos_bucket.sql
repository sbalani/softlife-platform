-- Batch-code photos taken when logging a refill (web + mobile app).
insert into storage.buckets (id, name, public)
values ('reposicion-photos', 'reposicion-photos', true)
on conflict (id) do nothing;
