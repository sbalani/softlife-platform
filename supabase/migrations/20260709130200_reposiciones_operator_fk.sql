-- operator_id was a bare uuid with no referential integrity. Now that it's
-- always a real auth user id (web refills use the signed-in user; the mobile
-- app will need to switch off its old numeric stub id to match), link it to
-- profiles so the refill history can show a name instead of a raw uuid.
alter table public.reposiciones
  add constraint reposiciones_operator_id_fkey foreign key (operator_id) references public.profiles(id) on delete set null;
