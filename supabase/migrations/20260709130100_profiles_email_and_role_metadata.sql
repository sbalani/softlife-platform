-- Store email on the profile (avoids a separate admin-API call just to list
-- users), and let signup pick up role/full_name from user_metadata so a user
-- created via the admin API (Settings -> Users) lands with the right role
-- immediately instead of defaulting to 'operator' and needing a follow-up.
alter table public.profiles add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'operator')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
