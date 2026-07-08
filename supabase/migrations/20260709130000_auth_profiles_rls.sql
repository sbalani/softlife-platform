-- profiles had no RLS at all — fine while every read went through the
-- service-role client, not fine now that the anon/cookie client (middleware,
-- session checks) queries it as the signed-in user. Read-only for regular
-- users (self or admin); all writes (creating users, setting roles) go
-- through the service-role-gated admin actions, which bypass RLS by design.
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_current_admin());

alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'operator'));
