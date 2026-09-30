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
          COALESCE(btrim(source_snapshot->>'pay_type_raw') IN ('免费', 'Free', '自动制作', 'Admin override', '串码支付', 'Coupon'), false)
          AND gross_cents = 0
        )
        OR (
          NOT COALESCE(btrim(source_snapshot->>'pay_type_raw') IN ('免费', 'Free', '自动制作', 'Admin override', '串码支付', 'Coupon'), false)
          AND gross_cents > 0
        )
      )
    )
  ) IS TRUE);

ALTER TABLE public.fiscal_invoice_documents
  DROP CONSTRAINT fiscal_invoice_documents_zero_value_reason_check,
  ADD CONSTRAINT fiscal_invoice_documents_zero_value_reason_check CHECK (
    (gross_cents = 0 AND invoice_payload->>'zero_value_reason' IN ('free', 'admin_override', 'coupon'))
    OR (gross_cents > 0 AND invoice_payload->>'zero_value_reason' IS NULL)
  );

CREATE OR REPLACE FUNCTION public.validate_fiscal_invoice_zero_value_source()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expected_reason TEXT;
  v_capability INTEGER;
BEGIN
  SELECT CASE btrim(item.source_snapshot->>'pay_type_raw')
    WHEN '免费' THEN 'free'
    WHEN 'Free' THEN 'free'
    WHEN '自动制作' THEN 'admin_override'
    WHEN 'Admin override' THEN 'admin_override'
    WHEN '串码支付' THEN 'coupon'
    WHEN 'Coupon' THEN 'coupon'
    ELSE NULL
  END INTO v_expected_reason
  FROM public.fiscal_preflight_items item
  WHERE item.id = NEW.preflight_item_id;

  IF NOT FOUND OR NEW.invoice_payload->>'zero_value_reason' IS DISTINCT FROM v_expected_reason THEN
    RAISE EXCEPTION 'Fiscal invoice zero-value reason does not match its frozen source';
  END IF;

  SELECT (report.payload->'capabilities'->>'fiscal_zero_value_invoices')::integer
  INTO v_capability
  FROM public.fiscal_invoice_batches batch
  JOIN public.odoo_fiscal_configuration_reports report ON report.id = batch.configuration_report_id
  WHERE batch.id = NEW.batch_id;

  IF v_capability IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Odoo zero-value fiscal invoice capability version 2 is required';
  END IF;
  RETURN NEW;
END;
$$;
