ALTER TABLE public.odoo_fiscal_settings
  ADD COLUMN tax_treatment_approved_at TIMESTAMPTZ,
  ADD COLUMN tax_treatment_approval_basis TEXT;

DO $$
DECLARE settings public.odoo_fiscal_settings%ROWTYPE;
BEGIN
  SELECT * INTO STRICT settings FROM public.odoo_fiscal_settings WHERE singleton = true;
  IF settings.vat_rate <> 10
    OR settings.currency <> 'EUR'
    OR settings.journal_code <> 'VEND'
    OR settings.customer_odoo_id <> 722
    OR settings.income_account_code <> '701000' THEN
    RAISE EXCEPTION 'Approved vending fiscal settings do not match the confirmed configuration';
  END IF;
END;
$$;

UPDATE public.odoo_fiscal_settings
SET tax_treatment_approved = true,
    tax_treatment_approved_at = now(),
    tax_treatment_approval_basis = 'Business confirmation: all current vending ice cream products use 10% VAT; operations began July 2026 and no Modelo 303 had been filed.',
    updated_at = now()
WHERE singleton = true;
