CREATE OR REPLACE FUNCTION public.create_fiscal_invoice_draft_batch(
  p_preflight_run_id UUID, p_configuration_report_id UUID, p_requested_by UUID,
  p_payload JSONB, p_payload_sha256 TEXT, p_documents JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.fiscal_preflight_runs%ROWTYPE;
  v_report public.odoo_fiscal_configuration_reports%ROWTYPE;
  v_request_id UUID;
  v_batch_id UUID;
  v_document_count INTEGER;
  v_eligible_count INTEGER;
  v_local_from DATE;
  v_local_to DATE;
BEGIN
  SELECT * INTO v_run FROM public.fiscal_preflight_runs WHERE id = p_preflight_run_id;
  IF NOT FOUND OR v_run.status <> 'ready' THEN RAISE EXCEPTION 'A ready fiscal preflight is required'; END IF;
  SELECT * INTO v_report FROM public.odoo_fiscal_configuration_reports WHERE id = p_configuration_report_id;
  IF NOT FOUND OR NOT v_report.accepted OR v_run.configuration_report_id IS DISTINCT FROM v_report.id
    OR p_payload->>'configuration_report_id' IS DISTINCT FROM v_report.id::text
    OR p_payload->>'configuration_payload_sha256' IS DISTINCT FROM v_report.payload_sha256
    OR (p_payload->'company'->>'odoo_id')::integer IS DISTINCT FROM (v_report.payload->'company'->>'odoo_id')::integer
    OR upper(btrim(p_payload->'company'->>'country_code')) IS DISTINCT FROM upper(btrim(v_report.payload->'company'->>'country_code'))
    OR upper(btrim(p_payload->'company'->>'currency')) IS DISTINCT FROM upper(btrim(v_report.payload->'company'->>'currency'))
    OR upper(btrim(p_payload->'journal'->>'code')) IS DISTINCT FROM upper(btrim(v_report.payload->'journal'->>'code'))
    OR (p_payload->'customer'->>'odoo_id')::integer IS DISTINCT FROM (v_report.payload->'customer'->>'odoo_id')::integer
    OR (p_payload->'tax'->>'odoo_tax_id')::integer IS DISTINCT FROM (v_report.payload->'tax'->>'odoo_id')::integer
    OR (p_payload->'tax'->>'rate')::numeric IS DISTINCT FROM (v_report.payload->'tax'->>'rate')::numeric
    OR upper(btrim(p_payload->'tax'->>'country_code')) IS DISTINCT FROM upper(btrim(v_report.payload->'tax'->>'country_code'))
    OR btrim(p_payload->'tax'->>'type_tax_use') IS DISTINCT FROM btrim(v_report.payload->'tax'->>'type_tax_use')
    OR btrim(p_payload->'tax'->>'amount_type') IS DISTINCT FROM btrim(v_report.payload->'tax'->>'amount_type')
    OR (p_payload->'tax'->>'price_include')::boolean IS DISTINCT FROM (v_report.payload->'tax'->>'price_include')::boolean THEN
    RAISE EXCEPTION 'The exact accepted preflight configuration report is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.odoo_fiscal_settings
    WHERE singleton AND tax_treatment_approved
      AND upper(journal_code) = upper(p_payload->'journal'->>'code')
      AND customer_odoo_id = (p_payload->'customer'->>'odoo_id')::integer
      AND upper(currency) = upper(p_payload->'company'->>'currency')
      AND vat_rate = (p_payload->'tax'->>'rate')::numeric
  ) THEN RAISE EXCEPTION 'Current approved fiscal settings do not match the accepted report'; END IF;
  IF jsonb_typeof(p_documents) <> 'array' OR jsonb_array_length(p_documents) NOT BETWEEN 1 AND 500
    OR jsonb_array_length(p_payload->'invoices') <> jsonb_array_length(p_documents) THEN
    RAISE EXCEPTION 'Fiscal invoice batch must contain between 1 and 500 documents';
  END IF;
  SELECT count(*) INTO v_eligible_count
  FROM public.fiscal_preflight_items WHERE run_id = v_run.id AND status = 'eligible';
  v_local_from := (v_run.period_from AT TIME ZONE v_run.time_zone)::date;
  v_local_to := ((v_run.period_to AT TIME ZONE v_run.time_zone)::date - 1);
  IF v_eligible_count <> jsonb_array_length(p_documents) OR EXISTS (
    SELECT 1 FROM public.fiscal_preflight_items WHERE run_id = v_run.id AND status = 'eligible' AND refund_required
  ) THEN RAISE EXCEPTION 'Every eligible non-refund-warning preflight item must be queued exactly once'; END IF;

  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_draft_creation', p_requested_by, p_payload, p_payload_sha256) RETURNING id INTO v_request_id;
  INSERT INTO public.fiscal_invoice_batches(
    preflight_run_id, configuration_report_id, period_from, period_to, local_date_from, local_date_to,
    status, draft_request_id, latest_draft_request_id, payload, payload_sha256, requested_by
  ) VALUES (
    v_run.id, v_report.id, v_run.period_from, v_run.period_to, v_local_from, v_local_to,
    'draft_pending', v_request_id, v_request_id, p_payload, p_payload_sha256, p_requested_by
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.fiscal_invoice_documents(
    id, batch_id, preflight_item_id, source_order_id, source_sha256, invoice_payload, invoice_payload_sha256,
    operation_at, invoice_date, order_code, payment_reference, currency, gross_cents, tax_base_cents,
    vat_cents, odoo_product_id, odoo_tax_id, reference, status
  )
  SELECT d.platform_invoice_id, v_batch_id, i.id, i.order_id, i.source_sha256, d.invoice_payload,
    d.invoice_payload_sha256, i.operation_at, i.operation_local_date, i.order_code, i.payment_reference,
    v_run.currency, i.gross_cents, i.tax_base_cents, i.vat_cents, i.odoo_product_id, d.odoo_tax_id,
    d.reference, 'draft_pending'
  FROM jsonb_to_recordset(p_documents) AS d(
    platform_invoice_id UUID, preflight_item_id UUID, invoice_payload JSONB, invoice_payload_sha256 TEXT,
    odoo_tax_id INTEGER, reference TEXT
  ) JOIN public.fiscal_preflight_items i ON i.id = d.preflight_item_id
  WHERE i.run_id = v_run.id AND i.status = 'eligible' AND NOT i.refund_required
    AND d.invoice_payload->>'platform_invoice_id' = d.platform_invoice_id::text
    AND d.invoice_payload->>'invoice_payload_sha256' = d.invoice_payload_sha256
    AND p_payload->'invoices' @> jsonb_build_array(d.invoice_payload)
    AND d.invoice_payload->>'move_type' = 'out_invoice'
    AND d.invoice_payload->>'invoice_date' = i.operation_local_date::text
    AND d.invoice_payload->>'currency' = v_run.currency
    AND d.invoice_payload->>'reference' = d.reference
    AND d.reference = COALESCE(NULLIF(btrim(i.payment_reference), ''), i.order_code)
    AND (d.invoice_payload->>'expected_total_cents')::bigint = i.gross_cents
    AND jsonb_array_length(d.invoice_payload->'lines') = 1
    AND (d.invoice_payload->'lines'->0->>'odoo_product_id')::integer = i.odoo_product_id
    AND d.invoice_payload->'lines'->0->>'description' = i.description
    AND (d.invoice_payload->'lines'->0->>'quantity')::numeric = i.units
    AND (d.invoice_payload->'lines'->0->>'gross_cents')::bigint = i.gross_cents
    AND (d.invoice_payload->'lines'->0->>'tax_base_cents')::bigint = i.tax_base_cents
    AND (d.invoice_payload->'lines'->0->>'vat_cents')::bigint = i.vat_cents
    AND (d.invoice_payload->'lines'->0->>'odoo_tax_id')::integer = d.odoo_tax_id
    AND d.odoo_tax_id = (v_report.payload->'tax'->>'odoo_id')::integer;
  GET DIAGNOSTICS v_document_count = ROW_COUNT;
  IF v_document_count <> v_eligible_count THEN RAISE EXCEPTION 'Fiscal invoice document/source mismatch'; END IF;
  RETURN jsonb_build_object('batch_id', v_batch_id, 'request_id', v_request_id, 'document_count', v_document_count);
END;
$$;
