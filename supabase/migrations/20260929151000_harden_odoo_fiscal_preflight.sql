REVOKE INSERT, UPDATE, DELETE ON public.fiscal_preflight_runs FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_preflight_items FROM service_role;
GRANT SELECT ON public.fiscal_preflight_runs, public.fiscal_preflight_items TO service_role;

ALTER TABLE public.odoo_fiscal_settings
  ADD CONSTRAINT odoo_fiscal_settings_posting_disabled CHECK (posting_enabled = false);

ALTER TABLE public.fiscal_preflight_runs
  DROP CONSTRAINT fiscal_preflight_runs_requested_by_fkey,
  ADD CONSTRAINT fiscal_preflight_runs_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;
