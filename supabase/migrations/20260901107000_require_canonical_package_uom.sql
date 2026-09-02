ALTER TABLE public.odoo_products
  ADD CONSTRAINT odoo_products_package_content_uom_canonical CHECK (
    package_content_uom IS NULL OR lower(btrim(package_content_uom)) IN ('g', 'kg', 'ml', 'l')
  );
