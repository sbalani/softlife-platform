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

  IF v_capability IS NULL OR v_capability NOT IN (1, 2) OR (v_expected_reason = 'coupon' AND v_capability <> 2) THEN
    RAISE EXCEPTION 'Odoo zero-value fiscal invoice capability is not supported for this payment type';
  END IF;
  RETURN NEW;
END;
$$;
