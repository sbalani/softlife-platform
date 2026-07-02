-- Ingredients are a global catalog, not tenant-scoped.
alter table public.products alter column tenant_id drop not null;

-- Global ingredients (tenant_id null) visible to all tenants + admins.
drop policy if exists tenant_isolation on public.products;
create policy tenant_isolation on public.products
  using (tenant_id is null or tenant_id = public.current_tenant_id() or public.is_current_admin())
  with check (tenant_id is null or tenant_id = public.current_tenant_id() or public.is_current_admin());
