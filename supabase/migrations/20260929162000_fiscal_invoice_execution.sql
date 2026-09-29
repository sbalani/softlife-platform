CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.odoo_sync_requests
  DROP CONSTRAINT odoo_sync_requests_kind_check,
  DROP CONSTRAINT odoo_sync_requests_fiscal_payload_check,
  ADD CONSTRAINT odoo_sync_requests_kind_check CHECK (kind IN (
    'stock_snapshot', 'fiscal_product_remediation',
    'fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation'
  )),
  ADD CONSTRAINT odoo_sync_requests_fiscal_payload_check CHECK ((
    (kind = 'stock_snapshot' AND payload = '{}'::jsonb AND payload_sha256 IS NULL)
    OR (kind = 'fiscal_product_remediation' AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1' AND jsonb_typeof(payload->'products') = 'array' AND payload_sha256 IS NOT NULL)
    OR (kind IN ('fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation')
      AND payload <> '{}'::jsonb AND payload->>'contract_version' = '1'
      AND jsonb_typeof(payload->'company') = 'object' AND jsonb_typeof(payload->'invoices') = 'array'
      AND jsonb_array_length(payload->'invoices') BETWEEN 1 AND 500 AND payload_sha256 IS NOT NULL)
  ) IS TRUE);

CREATE TABLE public.fiscal_invoice_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preflight_run_id UUID NOT NULL REFERENCES public.fiscal_preflight_runs(id) ON DELETE RESTRICT,
  configuration_report_id UUID NOT NULL REFERENCES public.odoo_fiscal_configuration_reports(id) ON DELETE RESTRICT,
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  local_date_from DATE NOT NULL,
  local_date_to DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft_pending', 'draft_ready', 'confirmation_pending', 'confirmation_failed', 'completed', 'failed', 'cancelled')),
  draft_request_id UUID NOT NULL UNIQUE REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  latest_draft_request_id UUID NOT NULL UNIQUE REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  latest_confirmation_request_id UUID UNIQUE REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  draft_completed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to > period_from AND local_date_to >= local_date_from),
  CHECK ((payload->>'contract_version' = '1' AND jsonb_typeof(payload->'invoices') = 'array') IS TRUE)
);

ALTER TABLE public.fiscal_invoice_batches ADD CONSTRAINT fiscal_invoice_batches_no_active_overlap
  EXCLUDE USING gist (tstzrange(period_from, period_to, '[)') WITH &&) WHERE (status <> 'cancelled');

CREATE INDEX fiscal_invoice_batches_requested_idx ON public.fiscal_invoice_batches(requested_at DESC);

CREATE TABLE public.fiscal_invoice_documents (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.fiscal_invoice_batches(id) ON DELETE RESTRICT,
  preflight_item_id UUID NOT NULL UNIQUE REFERENCES public.fiscal_preflight_items(id) ON DELETE RESTRICT,
  source_order_id UUID NOT NULL UNIQUE REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  invoice_payload JSONB NOT NULL CHECK (jsonb_typeof(invoice_payload) = 'object'),
  invoice_payload_sha256 TEXT NOT NULL CHECK (invoice_payload_sha256 ~ '^[0-9a-f]{64}$'),
  operation_at TIMESTAMPTZ NOT NULL,
  invoice_date DATE NOT NULL,
  order_code TEXT NOT NULL CHECK (NULLIF(btrim(order_code), '') IS NOT NULL),
  payment_reference TEXT,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_cents BIGINT NOT NULL CHECK (gross_cents > 0),
  tax_base_cents BIGINT NOT NULL CHECK (tax_base_cents >= 0),
  vat_cents BIGINT NOT NULL CHECK (vat_cents >= 0 AND tax_base_cents + vat_cents = gross_cents),
  odoo_product_id INTEGER NOT NULL CHECK (odoo_product_id > 0),
  odoo_tax_id INTEGER NOT NULL CHECK (odoo_tax_id > 0),
  reference TEXT NOT NULL CHECK (NULLIF(btrim(reference), '') IS NOT NULL),
  status TEXT NOT NULL CHECK (status IN ('draft_pending', 'draft', 'confirmation_pending', 'posted', 'draft_failed')),
  odoo_move_id INTEGER CHECK (odoo_move_id IS NULL OR odoo_move_id > 0),
  odoo_state TEXT CHECK (odoo_state IS NULL OR odoo_state IN ('draft', 'posted')),
  odoo_name TEXT,
  draft_created_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((invoice_payload->>'platform_invoice_id' = id::text) IS TRUE),
  CHECK ((invoice_payload->>'invoice_payload_sha256' = invoice_payload_sha256) IS TRUE)
);

CREATE INDEX fiscal_invoice_documents_batch_status_idx ON public.fiscal_invoice_documents(batch_id, status, invoice_date, id);
CREATE UNIQUE INDEX fiscal_invoice_documents_odoo_move_unique_idx
  ON public.fiscal_invoice_documents(odoo_move_id) WHERE odoo_move_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_fiscal_invoice_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.preflight_item_id IS DISTINCT FROM OLD.preflight_item_id
    OR NEW.source_order_id IS DISTINCT FROM OLD.source_order_id OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
    OR NEW.invoice_payload IS DISTINCT FROM OLD.invoice_payload OR NEW.invoice_payload_sha256 IS DISTINCT FROM OLD.invoice_payload_sha256
    OR NEW.operation_at IS DISTINCT FROM OLD.operation_at OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
    OR NEW.order_code IS DISTINCT FROM OLD.order_code OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.gross_cents IS DISTINCT FROM OLD.gross_cents
    OR NEW.tax_base_cents IS DISTINCT FROM OLD.tax_base_cents OR NEW.vat_cents IS DISTINCT FROM OLD.vat_cents
    OR NEW.odoo_product_id IS DISTINCT FROM OLD.odoo_product_id OR NEW.odoo_tax_id IS DISTINCT FROM OLD.odoo_tax_id
    OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Fiscal invoice document source fields are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_invoice_documents_source_immutable BEFORE UPDATE ON public.fiscal_invoice_documents
FOR EACH ROW EXECUTE FUNCTION public.prevent_fiscal_invoice_source_mutation();

CREATE OR REPLACE FUNCTION public.prevent_fiscal_invoice_batch_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.preflight_run_id IS DISTINCT FROM OLD.preflight_run_id OR NEW.configuration_report_id IS DISTINCT FROM OLD.configuration_report_id
    OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
    OR NEW.local_date_from IS DISTINCT FROM OLD.local_date_from OR NEW.local_date_to IS DISTINCT FROM OLD.local_date_to
    OR NEW.draft_request_id IS DISTINCT FROM OLD.draft_request_id OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256 OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'Fiscal invoice batch source fields are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_invoice_batches_source_immutable BEFORE UPDATE ON public.fiscal_invoice_batches
FOR EACH ROW EXECUTE FUNCTION public.prevent_fiscal_invoice_batch_source_mutation();

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
    OR (p_payload->'tax'->>'odoo_id')::integer IS DISTINCT FROM (v_report.payload->'tax'->>'odoo_id')::integer
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

CREATE OR REPLACE FUNCTION public.retry_fiscal_invoice_draft_batch(p_batch_id UUID, p_requested_by UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_request_id UUID;
  v_document_count INTEGER;
BEGIN
  SELECT * INTO v_batch FROM public.fiscal_invoice_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status <> 'failed' THEN RAISE EXCEPTION 'Only a failed fiscal invoice draft batch can be retried'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.odoo_fiscal_settings WHERE singleton AND tax_treatment_approved) THEN
    RAISE EXCEPTION 'Current vending tax treatment approval is required';
  END IF;
  SELECT count(*) INTO v_document_count FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id;
  IF v_document_count = 0 OR EXISTS (
    SELECT 1 FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id AND status <> 'draft_failed'
  ) THEN RAISE EXCEPTION 'Every batch document must be draft_failed before retry'; END IF;

  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_draft_creation', p_requested_by, v_batch.payload, v_batch.payload_sha256)
  RETURNING id INTO v_request_id;
  UPDATE public.fiscal_invoice_documents SET status = 'draft_pending'
    WHERE batch_id = v_batch.id AND status = 'draft_failed';
  UPDATE public.fiscal_invoice_batches SET status = 'draft_pending', latest_draft_request_id = v_request_id,
    failed_at = NULL, error = NULL WHERE id = v_batch.id;
  RETURN jsonb_build_object('batch_id', v_batch.id, 'request_id', v_request_id, 'document_count', v_document_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_fiscal_invoice_confirmation(
  p_batch_id UUID, p_requested_by UUID, p_document_ids JSONB, p_payload JSONB, p_payload_sha256 TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_request_id UUID;
  v_expected INTEGER;
  v_updated INTEGER;
BEGIN
  IF jsonb_typeof(p_document_ids) <> 'array' OR jsonb_array_length(p_document_ids) NOT BETWEEN 1 AND 500
    OR jsonb_array_length(p_payload->'invoices') <> jsonb_array_length(p_document_ids) THEN
    RAISE EXCEPTION 'Select between 1 and 500 invoice documents';
  END IF;
  v_expected := jsonb_array_length(p_document_ids);
  SELECT * INTO v_batch FROM public.fiscal_invoice_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status NOT IN ('draft_ready', 'confirmation_failed')
    OR p_payload->'company'->>'odoo_id' IS DISTINCT FROM v_batch.payload->'company'->>'odoo_id' THEN
    RAISE EXCEPTION 'Invoice batch is not ready for confirmation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.odoo_fiscal_settings WHERE singleton AND tax_treatment_approved) THEN
    RAISE EXCEPTION 'Current vending tax treatment approval is required';
  END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_document_ids)) <> v_expected
    OR (SELECT count(DISTINCT invoice->>'platform_invoice_id') FROM jsonb_array_elements(p_payload->'invoices') invoice) <> v_expected
    OR EXISTS (
      (SELECT value::uuid FROM jsonb_array_elements_text(p_document_ids))
      EXCEPT
      (SELECT (invoice->>'platform_invoice_id')::uuid FROM jsonb_array_elements(p_payload->'invoices') invoice)
    )
    OR EXISTS (
      (SELECT (invoice->>'platform_invoice_id')::uuid FROM jsonb_array_elements(p_payload->'invoices') invoice)
      EXCEPT
      (SELECT value::uuid FROM jsonb_array_elements_text(p_document_ids))
    ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_document_ids) selected
    LEFT JOIN public.fiscal_invoice_documents d ON d.id = selected.value::uuid AND d.batch_id = p_batch_id AND d.status = 'draft'
    WHERE d.id IS NULL
  ) THEN RAISE EXCEPTION 'Only exact draft documents from this batch may be selected'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'invoices') invoice
    LEFT JOIN public.fiscal_invoice_documents d ON d.id = (invoice->>'platform_invoice_id')::uuid
      AND d.batch_id = p_batch_id AND d.status = 'draft'
      AND d.odoo_move_id = (invoice->>'odoo_move_id')::integer
      AND d.invoice_payload_sha256 = invoice->>'invoice_payload_sha256'
    WHERE d.id IS NULL
  ) THEN RAISE EXCEPTION 'Confirmation payload does not match the selected draft documents'; END IF;

  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_bulk_confirmation', p_requested_by, p_payload, p_payload_sha256) RETURNING id INTO v_request_id;
  UPDATE public.fiscal_invoice_documents SET status = 'confirmation_pending'
  WHERE batch_id = p_batch_id AND status = 'draft' AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_document_ids));
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_expected THEN RAISE EXCEPTION 'Draft invoice selection changed'; END IF;
  UPDATE public.fiscal_invoice_batches SET status = 'confirmation_pending', latest_confirmation_request_id = v_request_id,
    failed_at = NULL, error = NULL WHERE id = p_batch_id AND status IN ('draft_ready', 'confirmation_failed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice batch is not ready for confirmation'; END IF;
  RETURN jsonb_build_object('batch_id', p_batch_id, 'request_id', v_request_id, 'document_count', v_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_odoo_sync_request(p_request_id UUID, p_claim_token UUID, p_result JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.odoo_sync_requests%ROWTYPE;
  v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_accepted BOOLEAN;
  v_expected INTEGER;
  v_invoice JSONB;
  v_document public.fiscal_invoice_documents%ROWTYPE;
  v_seen UUID[] := '{}';
  v_seen_move_ids INTEGER[] := '{}';
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR jsonb_typeof(p_result->'accepted') <> 'boolean' THEN
    RAISE EXCEPTION 'A structured sync result is required';
  END IF;
  SELECT * INTO v_request FROM public.odoo_sync_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Odoo sync request not found'; END IF;
  IF v_request.status IN ('completed', 'failed') AND v_request.claim_token = p_claim_token AND v_request.result = p_result THEN RETURN to_jsonb(v_request); END IF;
  IF v_request.status <> 'processing' OR v_request.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'Odoo sync request lease is stale' USING ERRCODE = 'P0001';
  END IF;
  v_accepted := (p_result->>'accepted')::BOOLEAN;

  IF v_request.kind IN ('fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation') THEN
    IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
      SELECT * INTO v_batch FROM public.fiscal_invoice_batches WHERE latest_draft_request_id = v_request.id FOR UPDATE;
    ELSE
      SELECT * INTO v_batch FROM public.fiscal_invoice_batches WHERE latest_confirmation_request_id = v_request.id FOR UPDATE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal invoice batch not found'; END IF;
    IF v_accepted THEN
      IF jsonb_typeof(p_result->'invoices') <> 'array' THEN RAISE EXCEPTION 'Invoice results are required'; END IF;
      v_expected := jsonb_array_length(v_request.payload->'invoices');
      IF jsonb_array_length(p_result->'invoices') <> v_expected THEN RAISE EXCEPTION 'Invoice result coverage mismatch'; END IF;
      -- Validate the complete response before updating any document.
      FOR v_invoice IN SELECT value FROM jsonb_array_elements(p_result->'invoices') LOOP
        IF (v_invoice->>'platform_invoice_id')::uuid = ANY(v_seen) THEN RAISE EXCEPTION 'Duplicate invoice result'; END IF;
        v_seen := array_append(v_seen, (v_invoice->>'platform_invoice_id')::uuid);
        IF (v_invoice->>'odoo_move_id')::integer = ANY(v_seen_move_ids) THEN RAISE EXCEPTION 'Duplicate Odoo move ID in invoice result'; END IF;
        v_seen_move_ids := array_append(v_seen_move_ids, (v_invoice->>'odoo_move_id')::integer);
        SELECT * INTO v_document FROM public.fiscal_invoice_documents
          WHERE id = (v_invoice->>'platform_invoice_id')::uuid AND batch_id = v_batch.id FOR UPDATE;
        IF NOT FOUND OR v_document.invoice_payload_sha256 <> v_invoice->>'invoice_payload_sha256'
          OR (v_invoice->>'odoo_move_id')::integer <= 0 THEN RAISE EXCEPTION 'Invoice result identity mismatch'; END IF;
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_request.payload->'invoices') expected
          WHERE expected->>'platform_invoice_id' = v_document.id::text
            AND expected->>'invoice_payload_sha256' = v_document.invoice_payload_sha256
            AND (v_request.kind = 'fiscal_invoice_draft_creation'
              OR (expected->>'odoo_move_id')::integer = (v_invoice->>'odoo_move_id')::integer)
        ) THEN RAISE EXCEPTION 'Invoice result is not a member of the exact request payload'; END IF;
        IF EXISTS (
          SELECT 1 FROM public.fiscal_invoice_documents other
          WHERE other.odoo_move_id = (v_invoice->>'odoo_move_id')::integer AND other.id <> v_document.id
        ) THEN RAISE EXCEPTION 'Odoo move ID is already assigned to another platform invoice'; END IF;
        IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
          IF v_document.status <> 'draft_pending' OR v_invoice->>'state' <> 'draft'
            OR jsonb_typeof(v_invoice->'created') <> 'boolean'
          THEN RAISE EXCEPTION 'Invalid draft invoice result'; END IF;
        ELSE
          IF v_document.status <> 'confirmation_pending' OR v_invoice->>'state' <> 'posted'
            OR NULLIF(btrim(v_invoice->>'name'), '') IS NULL OR jsonb_typeof(v_invoice->'confirmed') <> 'boolean'
            OR v_document.odoo_move_id <> (v_invoice->>'odoo_move_id')::integer
          THEN RAISE EXCEPTION 'Invalid confirmation result'; END IF;
        END IF;
      END LOOP;

      FOR v_invoice IN SELECT value FROM jsonb_array_elements(p_result->'invoices') LOOP
        IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
          UPDATE public.fiscal_invoice_documents SET status = 'draft',
            odoo_move_id = (v_invoice->>'odoo_move_id')::integer, odoo_state = v_invoice->>'state',
            odoo_name = NULL, draft_created_at = now(), posted_at = NULL
          WHERE id = (v_invoice->>'platform_invoice_id')::uuid;
        ELSE
          UPDATE public.fiscal_invoice_documents SET status = 'posted', odoo_state = 'posted',
            odoo_name = btrim(v_invoice->>'name'), posted_at = now()
          WHERE id = (v_invoice->>'platform_invoice_id')::uuid;
        END IF;
      END LOOP;
      IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
        UPDATE public.fiscal_invoice_batches SET status = 'draft_ready', draft_completed_at = now(), completed_at = NULL,
          failed_at = NULL, error = NULL WHERE id = v_batch.id;
      ELSE
        UPDATE public.fiscal_invoice_batches SET status = CASE WHEN EXISTS (
          SELECT 1 FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id AND status = 'draft'
        ) THEN 'draft_ready' ELSE 'completed' END,
          completed_at = CASE WHEN NOT EXISTS (SELECT 1 FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id AND status <> 'posted') THEN now() ELSE NULL END,
          failed_at = NULL, error = NULL WHERE id = v_batch.id;
      END IF;
    ELSE
      IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
        UPDATE public.fiscal_invoice_documents SET status = 'draft_failed' WHERE batch_id = v_batch.id AND status = 'draft_pending';
        UPDATE public.fiscal_invoice_batches SET status = 'failed', failed_at = now(), error = left(COALESCE(p_result->>'error', 'Odoo draft creation failed'), 5000) WHERE id = v_batch.id;
      ELSE
        UPDATE public.fiscal_invoice_documents SET status = 'draft' WHERE batch_id = v_batch.id AND status = 'confirmation_pending'
          AND id IN (SELECT (value->>'platform_invoice_id')::uuid FROM jsonb_array_elements(v_request.payload->'invoices'));
        UPDATE public.fiscal_invoice_batches SET status = 'confirmation_failed', failed_at = now(), error = left(COALESCE(p_result->>'error', 'Odoo confirmation failed'), 5000) WHERE id = v_batch.id;
      END IF;
    END IF;
  END IF;

  UPDATE public.odoo_sync_requests SET status = CASE WHEN v_accepted THEN 'completed' ELSE 'failed' END,
    completed_at = now(), result = p_result,
    error = CASE WHEN v_accepted THEN NULL ELSE left(COALESCE(p_result->>'error', 'Odoo sync failed'), 5000) END
  WHERE id = p_request_id RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END;
$$;

ALTER TABLE public.fiscal_invoice_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_invoice_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_invoice_batches, public.fiscal_invoice_documents FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_invoice_batches, public.fiscal_invoice_documents FROM service_role;
GRANT SELECT ON public.fiscal_invoice_batches, public.fiscal_invoice_documents TO service_role;
REVOKE ALL ON FUNCTION public.create_fiscal_invoice_draft_batch(UUID, UUID, UUID, JSONB, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_fiscal_invoice_confirmation(UUID, UUID, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_fiscal_invoice_draft_batch(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_fiscal_invoice_source_mutation(), public.prevent_fiscal_invoice_batch_source_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fiscal_invoice_draft_batch(UUID, UUID, UUID, JSONB, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_fiscal_invoice_confirmation(UUID, UUID, JSONB, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_fiscal_invoice_draft_batch(UUID, UUID) TO service_role;
