CREATE TABLE public.odoo_fiscal_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  journal_code TEXT NOT NULL DEFAULT 'VEND' CHECK (NULLIF(btrim(journal_code), '') IS NOT NULL AND char_length(journal_code) <= 5),
  customer_odoo_id INTEGER NOT NULL DEFAULT 722 CHECK (customer_odoo_id > 0),
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (vat_rate > 0 AND vat_rate < 100),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  income_account_code TEXT NOT NULL DEFAULT '701000' CHECK (NULLIF(btrim(income_account_code), '') IS NOT NULL),
  tax_treatment_approved BOOLEAN NOT NULL DEFAULT false,
  posting_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.odoo_fiscal_settings(singleton) VALUES (true);

CREATE TRIGGER odoo_fiscal_settings_set_updated_at
BEFORE UPDATE ON public.odoo_fiscal_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.odoo_fiscal_configuration_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version INTEGER NOT NULL CHECK (contract_version = 1),
  checked_at TIMESTAMPTZ NOT NULL,
  accepted BOOLEAN NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX odoo_fiscal_configuration_reports_checked_idx
  ON public.odoo_fiscal_configuration_reports(checked_at DESC, id DESC);

CREATE TABLE public.fiscal_preflight_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('ready', 'blocked')),
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL CHECK (NULLIF(btrim(time_zone), '') IS NOT NULL),
  tax_rate NUMERIC(5,2) NOT NULL CHECK (tax_rate > 0 AND tax_rate < 100),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  configuration_report_id UUID REFERENCES public.odoo_fiscal_configuration_reports(id) ON DELETE RESTRICT,
  settings_snapshot JSONB NOT NULL CHECK (jsonb_typeof(settings_snapshot) = 'object'),
  global_findings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(global_findings) = 'array'),
  summary JSONB NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to > period_from)
);

CREATE INDEX fiscal_preflight_runs_created_idx ON public.fiscal_preflight_runs(created_at DESC);

CREATE TABLE public.fiscal_preflight_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.fiscal_preflight_runs(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'blocked', 'excluded')),
  operation_at TIMESTAMPTZ,
  operation_local_date DATE,
  order_code TEXT NOT NULL,
  payment_reference TEXT,
  description TEXT,
  units NUMERIC,
  gross_cents BIGINT,
  tax_base_cents BIGINT,
  vat_cents BIGINT,
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE RESTRICT,
  odoo_product_id INTEGER,
  refund_required BOOLEAN NOT NULL DEFAULT false,
  refund_reference TEXT,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
  source_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, order_id),
  CHECK (
    status <> 'eligible'
    OR (operation_at IS NOT NULL AND operation_local_date IS NOT NULL AND gross_cents > 0
      AND tax_base_cents >= 0 AND vat_cents >= 0 AND tax_base_cents + vat_cents = gross_cents
      AND recipe_id IS NOT NULL AND odoo_product_id > 0)
  )
);

CREATE INDEX fiscal_preflight_items_run_status_idx ON public.fiscal_preflight_items(run_id, status, operation_at, order_id);
CREATE INDEX fiscal_preflight_items_order_idx ON public.fiscal_preflight_items(order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_fiscal_preflight_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Fiscal preflight records are immutable';
END;
$$;

CREATE TRIGGER odoo_fiscal_configuration_reports_immutable
BEFORE UPDATE OR DELETE ON public.odoo_fiscal_configuration_reports
FOR EACH ROW EXECUTE FUNCTION public.prevent_fiscal_preflight_mutation();

CREATE TRIGGER fiscal_preflight_runs_immutable
BEFORE UPDATE OR DELETE ON public.fiscal_preflight_runs
FOR EACH ROW EXECUTE FUNCTION public.prevent_fiscal_preflight_mutation();

CREATE TRIGGER fiscal_preflight_items_immutable
BEFORE UPDATE OR DELETE ON public.fiscal_preflight_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_fiscal_preflight_mutation();

CREATE OR REPLACE FUNCTION public.create_fiscal_preflight(
  p_period_from TIMESTAMPTZ,
  p_period_to TIMESTAMPTZ,
  p_time_zone TEXT,
  p_tax_rate NUMERIC,
  p_currency TEXT,
  p_configuration_report_id UUID,
  p_settings_snapshot JSONB,
  p_global_findings JSONB,
  p_summary JSONB,
  p_requested_by UUID,
  p_items JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id UUID;
  v_status TEXT;
  v_item_count INTEGER;
BEGIN
  IF p_period_to <= p_period_from THEN RAISE EXCEPTION 'Preflight period must be increasing'; END IF;
  IF jsonb_typeof(p_settings_snapshot) <> 'object' OR jsonb_typeof(p_global_findings) <> 'array'
    OR jsonb_typeof(p_summary) <> 'object' OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid fiscal preflight payload';
  END IF;
  IF jsonb_array_length(p_items) > 100000 THEN RAISE EXCEPTION 'Fiscal preflight is too large'; END IF;
  IF p_configuration_report_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.odoo_fiscal_configuration_reports WHERE id = p_configuration_report_id
  ) THEN RAISE EXCEPTION 'Fiscal configuration report not found'; END IF;

  v_status := CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_global_findings) finding
      WHERE finding->>'severity' = 'blocker'
    )
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) item WHERE item->>'status' = 'blocked')
    THEN 'blocked' ELSE 'ready' END;

  INSERT INTO public.fiscal_preflight_runs(
    status, period_from, period_to, time_zone, tax_rate, currency,
    configuration_report_id, settings_snapshot, global_findings, summary, requested_by
  ) VALUES (
    v_status, p_period_from, p_period_to, btrim(p_time_zone), p_tax_rate, upper(p_currency),
    p_configuration_report_id, p_settings_snapshot, p_global_findings, p_summary, p_requested_by
  ) RETURNING id INTO v_run_id;

  INSERT INTO public.fiscal_preflight_items(
    run_id, order_id, status, operation_at, operation_local_date, order_code, payment_reference,
    description, units, gross_cents, tax_base_cents, vat_cents, recipe_id, odoo_product_id,
    refund_required, refund_reference, findings, source_snapshot, source_sha256
  )
  SELECT
    v_run_id, item.order_id, item.status, item.operation_at, item.operation_local_date,
    item.order_code, item.payment_reference, item.description, item.units, item.gross_cents,
    item.tax_base_cents, item.vat_cents, item.recipe_id, item.odoo_product_id,
    item.refund_required, item.refund_reference, item.findings, item.source_snapshot, item.source_sha256
  FROM jsonb_to_recordset(p_items) AS item(
    order_id UUID, status TEXT, operation_at TIMESTAMPTZ, operation_local_date DATE,
    order_code TEXT, payment_reference TEXT, description TEXT, units NUMERIC,
    gross_cents BIGINT, tax_base_cents BIGINT, vat_cents BIGINT, recipe_id UUID,
    odoo_product_id INTEGER, refund_required BOOLEAN, refund_reference TEXT,
    findings JSONB, source_snapshot JSONB, source_sha256 TEXT
  );

  GET DIAGNOSTICS v_item_count = ROW_COUNT;
  IF v_item_count <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Fiscal preflight item count mismatch'; END IF;
  RETURN v_run_id;
END;
$$;

ALTER TABLE public.odoo_fiscal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odoo_fiscal_configuration_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_preflight_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_preflight_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.odoo_fiscal_settings, public.odoo_fiscal_configuration_reports,
  public.fiscal_preflight_runs, public.fiscal_preflight_items FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_fiscal_preflight(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, JSONB, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fiscal_preflight(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, JSONB, UUID, JSONB
) TO service_role;
