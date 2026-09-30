ALTER TABLE public.fiscal_preflight_items
  DROP CONSTRAINT fiscal_preflight_items_eligible_values_check,
  ADD CONSTRAINT fiscal_preflight_items_eligible_values_check CHECK ((
    status <> 'eligible'
    OR (
      operation_at IS NOT NULL
      AND operation_local_date IS NOT NULL
      AND gross_cents >= 0
      AND tax_base_cents >= 0
      AND vat_cents >= 0
      AND tax_base_cents + vat_cents = gross_cents
      AND recipe_id IS NOT NULL
      AND odoo_product_id > 0
      AND (
        (
          COALESCE(btrim(source_snapshot->>'pay_type_raw') IN ('免费', 'Free', '自动制作', 'Admin override'), false)
          AND gross_cents = 0
        )
        OR (
          NOT COALESCE(btrim(source_snapshot->>'pay_type_raw') IN ('免费', 'Free', '自动制作', 'Admin override'), false)
          AND gross_cents > 0
        )
      )
    )
  ) IS TRUE);
