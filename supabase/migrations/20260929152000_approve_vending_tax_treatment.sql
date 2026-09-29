UPDATE public.odoo_fiscal_settings
SET tax_treatment_approved = true,
    updated_at = now()
WHERE singleton = true;
