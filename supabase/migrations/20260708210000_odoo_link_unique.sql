-- One Odoo SKU should map to at most one platform ingredient.
-- (Postgres treats multiple NULLs as distinct, so unlinked rows are unaffected.)
alter table public.products add constraint products_odoo_id_unique unique (odoo_id);
