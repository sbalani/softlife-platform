ALTER TABLE public.odoo_sync_requests
  DROP CONSTRAINT odoo_sync_requests_kind_check,
  DROP CONSTRAINT odoo_sync_requests_fiscal_payload_check,
  ADD CONSTRAINT odoo_sync_requests_kind_check CHECK (kind IN (
    'stock_snapshot', 'fiscal_product_remediation',
    'fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation',
    'fiscal_invoice_sale_link'
  )),
  ADD CONSTRAINT odoo_sync_requests_fiscal_payload_check CHECK ((
    (kind = 'stock_snapshot' AND payload = '{}'::jsonb AND payload_sha256 IS NULL)
    OR (kind = 'fiscal_product_remediation' AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1' AND jsonb_typeof(payload->'products') = 'array' AND payload_sha256 IS NOT NULL)
    OR (kind IN ('fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation')
      AND payload <> '{}'::jsonb AND payload->>'contract_version' = '1'
      AND jsonb_typeof(payload->'company') = 'object' AND jsonb_typeof(payload->'invoices') = 'array'
      AND jsonb_array_length(payload->'invoices') BETWEEN 1 AND 500 AND payload_sha256 IS NOT NULL)
    OR (kind = 'fiscal_invoice_sale_link' AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1' AND payload->>'local_month' ~ '^\d{4}-(0[1-9]|1[0-2])$'
      AND jsonb_typeof(payload->'links') = 'array'
      AND jsonb_array_length(payload->'links') BETWEEN 1 AND 500 AND payload_sha256 IS NOT NULL)
  ) IS TRUE);

ALTER TABLE public.fiscal_invoice_documents
  ADD COLUMN sale_link_status TEXT NOT NULL DEFAULT 'unlinked'
    CHECK (sale_link_status IN ('unlinked', 'pending', 'linked', 'failed')),
  ADD COLUMN sale_link_request_id UUID REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  ADD COLUMN odoo_sale_order_id INTEGER CHECK (odoo_sale_order_id IS NULL OR odoo_sale_order_id > 0),
  ADD COLUMN odoo_sale_order_line_id INTEGER CHECK (odoo_sale_order_line_id IS NULL OR odoo_sale_order_line_id > 0),
  ADD COLUMN sale_linked_at TIMESTAMPTZ,
  ADD COLUMN sale_link_error TEXT,
  ADD CONSTRAINT fiscal_invoice_documents_sale_link_state_check CHECK (
    (sale_link_status = 'unlinked' AND sale_link_request_id IS NULL AND odoo_sale_order_id IS NULL
      AND odoo_sale_order_line_id IS NULL AND sale_linked_at IS NULL)
    OR (sale_link_status IN ('pending', 'failed') AND sale_link_request_id IS NOT NULL
      AND odoo_sale_order_id IS NULL AND odoo_sale_order_line_id IS NULL AND sale_linked_at IS NULL)
    OR (sale_link_status = 'linked' AND sale_link_request_id IS NOT NULL
      AND odoo_sale_order_id IS NOT NULL AND odoo_sale_order_line_id IS NOT NULL AND sale_linked_at IS NOT NULL)
  );

CREATE INDEX fiscal_invoice_documents_sale_link_idx
  ON public.fiscal_invoice_documents(sale_link_status, invoice_date, id);

CREATE OR REPLACE FUNCTION public.queue_fiscal_invoice_sale_links(
  p_requested_by UUID, p_payload JSONB, p_payload_sha256 TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request_id UUID;
  v_expected INTEGER;
  v_matched INTEGER;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_payload->>'contract_version' <> '1'
    OR p_payload->>'local_month' !~ '^\d{4}-(0[1-9]|1[0-2])$'
    OR jsonb_typeof(p_payload->'links') <> 'array'
    OR jsonb_array_length(p_payload->'links') NOT BETWEEN 1 AND 500
    OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid frozen fiscal sale-link payload is required';
  END IF;
  v_expected := jsonb_array_length(p_payload->'links');
  IF (SELECT count(DISTINCT link->>'platform_invoice_id') FROM jsonb_array_elements(p_payload->'links') link) <> v_expected
    OR (SELECT count(DISTINCT link->>'odoo_move_id') FROM jsonb_array_elements(p_payload->'links') link) <> v_expected THEN
    RAISE EXCEPTION 'Fiscal sale-link identities must be unique';
  END IF;

  SELECT count(*) INTO v_matched
  FROM jsonb_to_recordset(p_payload->'links') AS link(
    platform_invoice_id UUID, invoice_payload_sha256 TEXT, odoo_move_id INTEGER,
    source_order_id UUID, export_id UUID, recipe_version_id UUID, odoo_warehouse_id INTEGER,
    odoo_sale_order_id INTEGER, odoo_product_id INTEGER, quantity NUMERIC
  )
  JOIN public.fiscal_invoice_documents document ON document.id = link.platform_invoice_id
    AND document.source_order_id = link.source_order_id
    AND document.invoice_payload_sha256 = link.invoice_payload_sha256
    AND document.odoo_move_id = link.odoo_move_id
    AND document.odoo_product_id = link.odoo_product_id
    AND document.status = 'posted' AND document.sale_link_status IN ('unlinked', 'failed')
    AND (document.invoice_payload->'lines'->0->>'quantity')::numeric = link.quantity
    AND document.invoice_date >= (p_payload->>'local_month' || '-01')::date
    AND document.invoice_date < ((p_payload->>'local_month' || '-01')::date + interval '1 month')
  JOIN public.huaxin_orders source_order ON source_order.id = link.source_order_id
    AND source_order.odoo_warehouse_id_at_sale = link.odoo_warehouse_id
  JOIN public.manufacturing_period_export_orders membership ON membership.order_id = link.source_order_id
    AND membership.export_id = link.export_id
  JOIN public.manufacturing_period_exports export ON export.id = link.export_id AND export.status = 'completed'
  WHERE link.quantity > 0 AND link.odoo_move_id > 0 AND link.odoo_warehouse_id > 0
    AND link.odoo_sale_order_id > 0 AND link.odoo_product_id > 0
    AND EXISTS (
      SELECT 1 FROM public.order_product_resolutions resolution
      WHERE resolution.order_id = link.source_order_id
        AND resolution.resolution_status = 'resolved'
        AND resolution.recipe_version_id = link.recipe_version_id
    )
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(export.odoo_result->'warehouses', '[]'::jsonb)) warehouse
      WHERE (warehouse->>'odoo_warehouse_id')::integer = link.odoo_warehouse_id
        AND (warehouse->>'sales_order_id')::integer = link.odoo_sale_order_id
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(export.payload->'warehouses', '[]'::jsonb)) payload_warehouse,
        jsonb_array_elements(COALESCE(payload_warehouse->'recipes', '[]'::jsonb)) recipe
      WHERE (payload_warehouse->>'odoo_warehouse_id')::integer = link.odoo_warehouse_id
        AND recipe->>'recipe_version_id' = link.recipe_version_id::text
        AND (recipe->>'odoo_finished_product_id')::integer = link.odoo_product_id
    );
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'Fiscal sale-link payload does not match posted invoices and completed production exports';
  END IF;

  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_sale_link', p_requested_by, p_payload, p_payload_sha256)
  RETURNING id INTO v_request_id;

  UPDATE public.fiscal_invoice_documents document SET
    sale_link_status = 'pending', sale_link_request_id = v_request_id, sale_link_error = NULL
  FROM jsonb_to_recordset(p_payload->'links') AS link(platform_invoice_id UUID)
  WHERE document.id = link.platform_invoice_id AND document.sale_link_status IN ('unlinked', 'failed');
  GET DIAGNOSTICS v_matched = ROW_COUNT;
  IF v_matched <> v_expected THEN RAISE EXCEPTION 'Fiscal sale-link source changed while queueing'; END IF;
  RETURN jsonb_build_object('request_id', v_request_id, 'document_count', v_expected);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_fiscal_invoice_sale_link_request(
  p_request_id UUID, p_claim_token UUID, p_result JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.odoo_sync_requests%ROWTYPE;
  v_accepted BOOLEAN;
  v_expected INTEGER;
  v_matched INTEGER;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
    OR jsonb_typeof(p_result->'accepted') <> 'boolean' THEN
    RAISE EXCEPTION 'A structured fiscal sale-link result is required';
  END IF;
  SELECT * INTO v_request FROM public.odoo_sync_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.kind <> 'fiscal_invoice_sale_link' THEN
    RAISE EXCEPTION 'Fiscal sale-link request not found';
  END IF;
  IF v_request.status IN ('completed', 'failed') AND v_request.claim_token = p_claim_token AND v_request.result = p_result THEN
    RETURN to_jsonb(v_request);
  END IF;
  IF v_request.status <> 'processing' OR v_request.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'Odoo sync request lease is stale' USING ERRCODE = 'P0001';
  END IF;
  v_accepted := (p_result->>'accepted')::boolean;
  IF NOT v_accepted THEN
    UPDATE public.fiscal_invoice_documents SET sale_link_status = 'failed',
      sale_link_error = left(COALESCE(p_result->>'error', 'Odoo sale-link reconciliation failed'), 5000)
    WHERE sale_link_request_id = v_request.id AND sale_link_status = 'pending';
    UPDATE public.odoo_sync_requests SET status = 'failed', completed_at = now(), result = p_result,
      error = left(COALESCE(p_result->>'error', 'Odoo sale-link reconciliation failed'), 5000)
    WHERE id = v_request.id RETURNING * INTO v_request;
    RETURN to_jsonb(v_request);
  END IF;

  v_expected := jsonb_array_length(v_request.payload->'links');
  IF jsonb_typeof(p_result->'links') <> 'array'
    OR jsonb_array_length(p_result->'links') <> v_expected THEN
    RAISE EXCEPTION 'Odoo fiscal sale-link result coverage is invalid';
  END IF;
  SELECT count(*) INTO v_matched
  FROM jsonb_to_recordset(p_result->'links') AS result(
    platform_invoice_id UUID, invoice_payload_sha256 TEXT, odoo_move_id INTEGER,
    odoo_sale_order_id INTEGER, odoo_sale_order_line_id INTEGER, linked BOOLEAN,
    already_linked BOOLEAN, sale_order_status TEXT
  )
  JOIN jsonb_to_recordset(v_request.payload->'links') AS source(
    platform_invoice_id UUID, invoice_payload_sha256 TEXT, odoo_move_id INTEGER,
    odoo_sale_order_id INTEGER
  ) ON source.platform_invoice_id = result.platform_invoice_id
    AND source.invoice_payload_sha256 = result.invoice_payload_sha256
    AND source.odoo_move_id = result.odoo_move_id
    AND source.odoo_sale_order_id = result.odoo_sale_order_id
  WHERE result.linked AND result.odoo_sale_order_line_id > 0
    AND result.sale_order_status IN ('to invoice', 'invoiced', 'no');
  IF v_matched <> v_expected
    OR (SELECT count(DISTINCT link->>'platform_invoice_id') FROM jsonb_array_elements(p_result->'links') link) <> v_expected THEN
    RAISE EXCEPTION 'Odoo fiscal sale-link result identities are invalid';
  END IF;

  UPDATE public.fiscal_invoice_documents document SET
    sale_link_status = 'linked', odoo_sale_order_id = result.odoo_sale_order_id,
    odoo_sale_order_line_id = result.odoo_sale_order_line_id,
    sale_linked_at = now(), sale_link_error = NULL
  FROM jsonb_to_recordset(p_result->'links') AS result(
    platform_invoice_id UUID, odoo_sale_order_id INTEGER, odoo_sale_order_line_id INTEGER
  )
  WHERE document.id = result.platform_invoice_id
    AND document.sale_link_request_id = v_request.id AND document.sale_link_status = 'pending';
  GET DIAGNOSTICS v_matched = ROW_COUNT;
  IF v_matched <> v_expected THEN RAISE EXCEPTION 'Fiscal sale-link result could not be applied exactly'; END IF;
  UPDATE public.odoo_sync_requests SET status = 'completed', completed_at = now(), result = p_result, error = NULL
  WHERE id = v_request.id RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END;
$$;

REVOKE ALL ON FUNCTION public.queue_fiscal_invoice_sale_links(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_fiscal_invoice_sale_link_request(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_fiscal_invoice_sale_links(UUID, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_fiscal_invoice_sale_link_request(UUID, UUID, JSONB) TO service_role;
