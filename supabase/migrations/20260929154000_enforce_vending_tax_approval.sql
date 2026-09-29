ALTER TABLE public.odoo_fiscal_settings
  ADD CONSTRAINT odoo_fiscal_settings_approved_treatment_consistent CHECK (
    NOT tax_treatment_approved OR (
      vat_rate = 10
      AND currency = 'EUR'
      AND journal_code = 'VEND'
      AND customer_odoo_id = 722
      AND income_account_code = '701000'
      AND tax_treatment_approved_at IS NOT NULL
      AND NULLIF(btrim(tax_treatment_approval_basis), '') IS NOT NULL
    )
  );
