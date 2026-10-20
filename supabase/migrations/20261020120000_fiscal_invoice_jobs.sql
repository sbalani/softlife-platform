CREATE TABLE public.fiscal_invoice_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preflight_run_id UUID NOT NULL UNIQUE REFERENCES public.fiscal_preflight_runs(id) ON DELETE RESTRICT,
  configuration_report_id UUID NOT NULL REFERENCES public.odoo_fiscal_configuration_reports(id) ON DELETE RESTRICT,
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  local_date_from DATE NOT NULL,
  local_date_to DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft_pending', 'draft_ready', 'confirmation_pending', 'confirmation_failed', 'completed', 'failed', 'cancelled')),
  execution_decisions JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(execution_decisions) = 'object'),
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  draft_completed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to > period_from AND local_date_to >= local_date_from)
);

CREATE INDEX fiscal_invoice_jobs_requested_idx ON public.fiscal_invoice_jobs(requested_at DESC);

INSERT INTO public.fiscal_invoice_jobs(
  id, preflight_run_id, configuration_report_id, period_from, period_to, local_date_from, local_date_to,
  status, execution_decisions, requested_by, requested_at, draft_completed_at, completed_at, failed_at, error, updated_at
)
SELECT id, preflight_run_id, configuration_report_id, period_from, period_to, local_date_from, local_date_to,
  status, execution_decisions, requested_by, requested_at, draft_completed_at, completed_at, failed_at, error, updated_at
FROM public.fiscal_invoice_batches;

ALTER TABLE public.fiscal_invoice_jobs ADD CONSTRAINT fiscal_invoice_jobs_no_active_overlap
  EXCLUDE USING gist (tstzrange(period_from, period_to, '[)') WITH &&) WHERE (status <> 'cancelled');

ALTER TABLE public.fiscal_invoice_batches
  ADD COLUMN job_id UUID REFERENCES public.fiscal_invoice_jobs(id) ON DELETE RESTRICT,
  ADD COLUMN batch_sequence INTEGER,
  ADD COLUMN confirmation_payload JSONB CHECK (confirmation_payload IS NULL OR jsonb_typeof(confirmation_payload) = 'object'),
  ADD COLUMN confirmation_payload_sha256 TEXT CHECK (confirmation_payload_sha256 IS NULL OR confirmation_payload_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE public.fiscal_invoice_batches DISABLE TRIGGER fiscal_invoice_batches_source_immutable;
UPDATE public.fiscal_invoice_batches SET job_id = id, batch_sequence = 1;
ALTER TABLE public.fiscal_invoice_batches ENABLE TRIGGER fiscal_invoice_batches_source_immutable;

ALTER TABLE public.fiscal_invoice_batches
  ALTER COLUMN job_id SET NOT NULL,
  ALTER COLUMN batch_sequence SET NOT NULL,
  ALTER COLUMN draft_request_id DROP NOT NULL,
  ALTER COLUMN latest_draft_request_id DROP NOT NULL,
  DROP CONSTRAINT fiscal_invoice_batches_status_check,
  DROP CONSTRAINT fiscal_invoice_batches_no_active_overlap,
  ADD CONSTRAINT fiscal_invoice_batches_status_check CHECK (status IN ('queued', 'draft_pending', 'draft_ready', 'confirmation_pending', 'confirmation_failed', 'completed', 'failed', 'cancelled')),
  ADD CONSTRAINT fiscal_invoice_batches_sequence_check CHECK (batch_sequence > 0),
  ADD CONSTRAINT fiscal_invoice_batches_job_sequence_key UNIQUE (job_id, batch_sequence),
  ADD CONSTRAINT fiscal_invoice_batches_request_state_check CHECK (
    (status = 'queued' AND draft_request_id IS NULL AND latest_draft_request_id IS NULL)
    OR (status <> 'queued' AND draft_request_id IS NOT NULL AND latest_draft_request_id IS NOT NULL)
  ),
  ADD CONSTRAINT fiscal_invoice_batches_confirmation_payload_pair_check CHECK (
    (confirmation_payload IS NULL AND confirmation_payload_sha256 IS NULL)
    OR (confirmation_payload IS NOT NULL AND confirmation_payload_sha256 IS NOT NULL)
  );

ALTER TABLE public.fiscal_invoice_documents
  DROP CONSTRAINT fiscal_invoice_documents_status_check,
  ADD CONSTRAINT fiscal_invoice_documents_status_check CHECK (status IN ('queued', 'draft_pending', 'draft', 'confirmation_pending', 'posted', 'draft_failed'));

CREATE VIEW public.fiscal_invoice_job_progress WITH (security_invoker = true) AS
SELECT job.id AS job_id,
  count(DISTINCT batch.id) AS internal_batch_count,
  count(DISTINCT batch.id) FILTER (WHERE batch.status = 'completed') AS completed_internal_batch_count,
  count(document.id) AS document_count,
  count(document.id) FILTER (WHERE document.status = 'draft') AS draft_count,
  count(document.id) FILTER (WHERE document.status = 'posted') AS posted_count,
  coalesce(sum(document.gross_cents), 0) AS gross_cents
FROM public.fiscal_invoice_jobs job
LEFT JOIN public.fiscal_invoice_batches batch ON batch.job_id = job.id
LEFT JOIN public.fiscal_invoice_documents document ON document.batch_id = batch.id
GROUP BY job.id;

CREATE OR REPLACE FUNCTION public.prevent_fiscal_invoice_job_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.preflight_run_id IS DISTINCT FROM OLD.preflight_run_id OR NEW.configuration_report_id IS DISTINCT FROM OLD.configuration_report_id
    OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
    OR NEW.local_date_from IS DISTINCT FROM OLD.local_date_from OR NEW.local_date_to IS DISTINCT FROM OLD.local_date_to
    OR NEW.execution_decisions IS DISTINCT FROM OLD.execution_decisions OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'Fiscal invoice job source fields are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_invoice_jobs_source_immutable BEFORE UPDATE ON public.fiscal_invoice_jobs
FOR EACH ROW EXECUTE FUNCTION public.prevent_fiscal_invoice_job_source_mutation();

CREATE OR REPLACE FUNCTION public.prevent_fiscal_invoice_batch_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.batch_sequence IS DISTINCT FROM OLD.batch_sequence
    OR NEW.preflight_run_id IS DISTINCT FROM OLD.preflight_run_id OR NEW.configuration_report_id IS DISTINCT FROM OLD.configuration_report_id
    OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
    OR NEW.local_date_from IS DISTINCT FROM OLD.local_date_from OR NEW.local_date_to IS DISTINCT FROM OLD.local_date_to
    OR NEW.draft_request_id IS DISTINCT FROM OLD.draft_request_id AND OLD.draft_request_id IS NOT NULL
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
    OR NEW.execution_decisions IS DISTINCT FROM OLD.execution_decisions OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.confirmation_payload IS DISTINCT FROM OLD.confirmation_payload AND OLD.confirmation_payload IS NOT NULL
    OR NEW.confirmation_payload_sha256 IS DISTINCT FROM OLD.confirmation_payload_sha256 AND OLD.confirmation_payload_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'Fiscal invoice batch source fields are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_fiscal_invoice_job(
  p_preflight_run_id UUID, p_configuration_report_id UUID, p_requested_by UUID, p_batches JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.fiscal_preflight_runs%ROWTYPE;
  v_report public.odoo_fiscal_configuration_reports%ROWTYPE;
  v_job_id UUID;
  v_batch_id UUID;
  v_request_id UUID;
  v_batch JSONB;
  v_payload JSONB;
  v_documents JSONB;
  v_sequence INTEGER := 0;
  v_batch_count INTEGER;
  v_batch_documents INTEGER;
  v_inserted INTEGER;
  v_total_documents INTEGER := 0;
  v_eligible_count INTEGER;
  v_skipped_blocked INTEGER;
  v_skipped_excluded INTEGER;
  v_skipped_refund_review INTEGER;
  v_local_from DATE;
  v_local_to DATE;
BEGIN
  SELECT * INTO v_run FROM public.fiscal_preflight_runs WHERE id = p_preflight_run_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected fiscal preflight does not exist'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_run.global_findings) finding
    WHERE finding->>'severity' = 'blocker' AND finding->>'code' <> 'odoo_configuration_stale'
  ) THEN RAISE EXCEPTION 'The selected fiscal preflight has a non-bypassable configuration blocker'; END IF;
  SELECT * INTO v_report FROM public.odoo_fiscal_configuration_reports WHERE id = p_configuration_report_id;
  IF NOT FOUND OR NOT v_report.accepted OR v_run.configuration_report_id IS DISTINCT FROM v_report.id THEN
    RAISE EXCEPTION 'The exact accepted preflight configuration report is required';
  END IF;
  IF jsonb_typeof(p_batches) <> 'array' OR jsonb_array_length(p_batches) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'A bounded set of fiscal invoice batches is required';
  END IF;
  v_batch_count := jsonb_array_length(p_batches);
  IF (SELECT count(DISTINCT (batch->>'sequence')::integer) FROM jsonb_array_elements(p_batches) batch) <> v_batch_count
    OR (SELECT min((batch->>'sequence')::integer) FROM jsonb_array_elements(p_batches) batch) <> 1
    OR (SELECT max((batch->>'sequence')::integer) FROM jsonb_array_elements(p_batches) batch) <> v_batch_count THEN
    RAISE EXCEPTION 'Fiscal invoice batch sequences must be contiguous';
  END IF;
  SELECT count(*) FILTER (WHERE status = 'eligible' AND NOT refund_required), count(*) FILTER (WHERE status = 'blocked'),
    count(*) FILTER (WHERE status = 'excluded'), count(*) FILTER (WHERE status = 'eligible' AND refund_required)
  INTO v_eligible_count, v_skipped_blocked, v_skipped_excluded, v_skipped_refund_review
  FROM public.fiscal_preflight_items WHERE run_id = v_run.id;
  IF v_eligible_count = 0 THEN RAISE EXCEPTION 'No invoiceable sales remain'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_batches) batch, jsonb_array_elements(batch->'documents') document) <> v_eligible_count
    OR (SELECT count(DISTINCT document->>'platform_invoice_id') FROM jsonb_array_elements(p_batches) batch, jsonb_array_elements(batch->'documents') document) <> v_eligible_count
    OR (SELECT count(DISTINCT document->>'preflight_item_id') FROM jsonb_array_elements(p_batches) batch, jsonb_array_elements(batch->'documents') document) <> v_eligible_count THEN
    RAISE EXCEPTION 'Every invoiceable preflight item must be queued exactly once';
  END IF;
  IF EXISTS (
    SELECT item.id FROM public.fiscal_preflight_items item WHERE item.run_id = v_run.id AND item.status = 'eligible' AND NOT item.refund_required
    EXCEPT
    SELECT (document->>'preflight_item_id')::uuid FROM jsonb_array_elements(p_batches) batch, jsonb_array_elements(batch->'documents') document
  ) THEN RAISE EXCEPTION 'Fiscal invoice job does not cover every invoiceable preflight item'; END IF;

  v_local_from := (v_run.period_from AT TIME ZONE v_run.time_zone)::date;
  v_local_to := ((v_run.period_to AT TIME ZONE v_run.time_zone)::date - 1);
  INSERT INTO public.fiscal_invoice_jobs(
    preflight_run_id, configuration_report_id, period_from, period_to, local_date_from, local_date_to,
    status, execution_decisions, requested_by
  ) VALUES (
    v_run.id, v_report.id, v_run.period_from, v_run.period_to, v_local_from, v_local_to, 'draft_pending',
    jsonb_build_object('queued_invoiceable', v_eligible_count, 'skipped_blocked', v_skipped_blocked,
      'skipped_excluded', v_skipped_excluded, 'skipped_refund_review', v_skipped_refund_review,
      'configuration_report_checked_at', v_report.checked_at,
      'configuration_report_stale_at_execution', v_report.checked_at < now() - interval '24 hours'),
    p_requested_by
  ) RETURNING id INTO v_job_id;

  FOR v_batch IN SELECT value FROM jsonb_array_elements(p_batches) ORDER BY (value->>'sequence')::integer LOOP
    v_sequence := v_sequence + 1;
    v_payload := v_batch->'payload';
    v_documents := v_batch->'documents';
    IF (v_batch->>'sequence')::integer <> v_sequence OR jsonb_typeof(v_payload) <> 'object'
      OR v_payload->>'contract_version' <> '1' OR jsonb_typeof(v_payload->'invoices') <> 'array'
      OR jsonb_array_length(v_payload->'invoices') NOT BETWEEN 1 AND 500
      OR jsonb_typeof(v_documents) <> 'array'
      OR jsonb_array_length(v_documents) <> jsonb_array_length(v_payload->'invoices')
      OR v_batch->>'payload_sha256' !~ '^[0-9a-f]{64}$'
      OR v_payload->>'configuration_report_id' IS DISTINCT FROM v_report.id::text
      OR v_payload->>'configuration_payload_sha256' IS DISTINCT FROM v_report.payload_sha256
      OR (v_payload->'company'->>'odoo_id')::integer IS DISTINCT FROM (v_report.payload->'company'->>'odoo_id')::integer
      OR upper(btrim(v_payload->'company'->>'country_code')) IS DISTINCT FROM upper(btrim(v_report.payload->'company'->>'country_code'))
      OR upper(btrim(v_payload->'company'->>'currency')) IS DISTINCT FROM upper(btrim(v_report.payload->'company'->>'currency'))
      OR upper(btrim(v_payload->'journal'->>'code')) IS DISTINCT FROM upper(btrim(v_report.payload->'journal'->>'code'))
      OR (v_payload->'customer'->>'odoo_id')::integer IS DISTINCT FROM (v_report.payload->'customer'->>'odoo_id')::integer
      OR (v_payload->'tax'->>'odoo_tax_id')::integer IS DISTINCT FROM (v_report.payload->'tax'->>'odoo_id')::integer
      OR (v_payload->'tax'->>'rate')::numeric IS DISTINCT FROM (v_report.payload->'tax'->>'rate')::numeric
      OR upper(btrim(v_payload->'tax'->>'country_code')) IS DISTINCT FROM upper(btrim(v_report.payload->'tax'->>'country_code'))
      OR btrim(v_payload->'tax'->>'type_tax_use') IS DISTINCT FROM btrim(v_report.payload->'tax'->>'type_tax_use')
      OR btrim(v_payload->'tax'->>'amount_type') IS DISTINCT FROM btrim(v_report.payload->'tax'->>'amount_type')
      OR (v_payload->'tax'->>'price_include')::boolean IS DISTINCT FROM (v_report.payload->'tax'->>'price_include')::boolean THEN
      RAISE EXCEPTION 'Fiscal invoice batch % does not match the accepted configuration contract', v_sequence;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.odoo_fiscal_settings WHERE singleton AND tax_treatment_approved
        AND upper(journal_code) = upper(v_payload->'journal'->>'code')
        AND customer_odoo_id = (v_payload->'customer'->>'odoo_id')::integer
        AND upper(currency) = upper(v_payload->'company'->>'currency')
        AND vat_rate = (v_payload->'tax'->>'rate')::numeric
    ) THEN RAISE EXCEPTION 'Current approved fiscal settings do not match the accepted report'; END IF;
    IF v_sequence = 1 THEN
      INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
      VALUES ('fiscal_invoice_draft_creation', p_requested_by, v_payload, v_batch->>'payload_sha256')
      RETURNING id INTO v_request_id;
    ELSE
      v_request_id := NULL;
    END IF;
    INSERT INTO public.fiscal_invoice_batches(
      job_id, batch_sequence, preflight_run_id, configuration_report_id, period_from, period_to,
      local_date_from, local_date_to, status, draft_request_id, latest_draft_request_id,
      payload, payload_sha256, execution_decisions, requested_by
    ) VALUES (
      v_job_id, v_sequence, v_run.id, v_report.id, v_run.period_from, v_run.period_to,
      v_local_from, v_local_to, CASE WHEN v_sequence = 1 THEN 'draft_pending' ELSE 'queued' END,
      v_request_id, v_request_id, v_payload, v_batch->>'payload_sha256', '{}'::jsonb, p_requested_by
    ) RETURNING id INTO v_batch_id;

    INSERT INTO public.fiscal_invoice_documents(
      id, batch_id, preflight_item_id, source_order_id, source_sha256, invoice_payload, invoice_payload_sha256,
      operation_at, invoice_date, order_code, payment_reference, currency, gross_cents, tax_base_cents,
      vat_cents, odoo_product_id, odoo_tax_id, reference, status
    )
    SELECT document.platform_invoice_id, v_batch_id, item.id, item.order_id, item.source_sha256,
      document.invoice_payload, document.invoice_payload_sha256, item.operation_at, item.operation_local_date,
      item.order_code, item.payment_reference, v_run.currency, item.gross_cents, item.tax_base_cents,
      item.vat_cents, item.odoo_product_id, document.odoo_tax_id, document.reference,
      CASE WHEN v_sequence = 1 THEN 'draft_pending' ELSE 'queued' END
    FROM jsonb_to_recordset(v_documents) AS document(
      platform_invoice_id UUID, preflight_item_id UUID, invoice_payload JSONB, invoice_payload_sha256 TEXT,
      odoo_tax_id INTEGER, reference TEXT
    )
    JOIN public.fiscal_preflight_items item ON item.id = document.preflight_item_id
    WHERE item.run_id = v_run.id AND item.status = 'eligible' AND NOT item.refund_required
      AND document.invoice_payload->>'platform_invoice_id' = document.platform_invoice_id::text
      AND document.invoice_payload->>'invoice_payload_sha256' = document.invoice_payload_sha256
      AND v_payload->'invoices' @> jsonb_build_array(document.invoice_payload)
      AND document.invoice_payload->>'move_type' = 'out_invoice'
      AND document.invoice_payload->>'invoice_date' = item.operation_local_date::text
      AND document.invoice_payload->>'currency' = v_run.currency
      AND document.invoice_payload->>'reference' = document.reference
      AND document.reference = COALESCE(NULLIF(btrim(item.payment_reference), ''), item.order_code)
      AND (document.invoice_payload->>'expected_total_cents')::bigint = item.gross_cents
      AND jsonb_array_length(document.invoice_payload->'lines') = 1
      AND (document.invoice_payload->'lines'->0->>'odoo_product_id')::integer = item.odoo_product_id
      AND document.invoice_payload->'lines'->0->>'description' = item.description
      AND (document.invoice_payload->'lines'->0->>'quantity')::numeric = item.units
      AND (document.invoice_payload->'lines'->0->>'gross_cents')::bigint = item.gross_cents
      AND (document.invoice_payload->'lines'->0->>'tax_base_cents')::bigint = item.tax_base_cents
      AND (document.invoice_payload->'lines'->0->>'vat_cents')::bigint = item.vat_cents
      AND (document.invoice_payload->'lines'->0->>'odoo_tax_id')::integer = document.odoo_tax_id
      AND document.odoo_tax_id = (v_report.payload->'tax'->>'odoo_id')::integer;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_batch_documents := jsonb_array_length(v_documents);
    IF v_inserted <> v_batch_documents THEN RAISE EXCEPTION 'Fiscal invoice batch % document/source mismatch', v_sequence; END IF;
    v_total_documents := v_total_documents + v_inserted;
  END LOOP;
  RETURN jsonb_build_object('job_id', v_job_id, 'request_id', (
    SELECT latest_draft_request_id FROM public.fiscal_invoice_batches WHERE job_id = v_job_id AND batch_sequence = 1
  ), 'document_count', v_total_documents, 'batch_count', v_batch_count,
    'skipped_blocked', v_skipped_blocked, 'skipped_excluded', v_skipped_excluded,
    'skipped_refund_review', v_skipped_refund_review);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_fiscal_invoice_draft_job(p_job_id UUID, p_requested_by UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.fiscal_invoice_jobs%ROWTYPE;
  v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_request_id UUID;
  v_document_count INTEGER;
BEGIN
  SELECT * INTO v_job FROM public.fiscal_invoice_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'failed' THEN RAISE EXCEPTION 'Only a failed fiscal invoice draft job can be retried'; END IF;
  SELECT * INTO v_batch FROM public.fiscal_invoice_batches
    WHERE job_id = p_job_id AND status = 'failed' ORDER BY batch_sequence LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.fiscal_invoice_batches earlier
    WHERE earlier.job_id = p_job_id AND earlier.batch_sequence < v_batch.batch_sequence
      AND earlier.status NOT IN ('draft_ready', 'completed')
  ) THEN RAISE EXCEPTION 'The failed internal batch is not ready for retry'; END IF;
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
  UPDATE public.fiscal_invoice_documents SET status = 'draft_pending' WHERE batch_id = v_batch.id AND status = 'draft_failed';
  UPDATE public.fiscal_invoice_batches SET status = 'draft_pending', latest_draft_request_id = v_request_id,
    failed_at = NULL, error = NULL WHERE id = v_batch.id;
  UPDATE public.fiscal_invoice_jobs SET status = 'draft_pending', failed_at = NULL, error = NULL WHERE id = p_job_id;
  RETURN jsonb_build_object('job_id', p_job_id, 'batch_id', v_batch.id, 'request_id', v_request_id, 'document_count', v_document_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_fiscal_invoice_job_confirmation(
  p_job_id UUID, p_requested_by UUID, p_batches JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.fiscal_invoice_jobs%ROWTYPE;
  v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_batch_input JSONB;
  v_payload JSONB;
  v_expected INTEGER;
  v_total INTEGER := 0;
  v_batch_count INTEGER;
  v_request_id UUID;
BEGIN
  SELECT * INTO v_job FROM public.fiscal_invoice_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status NOT IN ('draft_ready', 'confirmation_failed') THEN
    RAISE EXCEPTION 'Fiscal invoice job is not ready for confirmation';
  END IF;
  IF jsonb_typeof(p_batches) <> 'array' OR jsonb_array_length(p_batches) < 1 THEN
    RAISE EXCEPTION 'Confirmation payloads are required';
  END IF;
  v_batch_count := jsonb_array_length(p_batches);
  IF v_batch_count <> (SELECT count(*) FROM public.fiscal_invoice_batches WHERE job_id = p_job_id AND status <> 'completed') THEN
    RAISE EXCEPTION 'Every unfinished internal batch must be confirmed exactly once';
  END IF;
  IF (SELECT count(DISTINCT batch->>'batch_id') FROM jsonb_array_elements(p_batches) batch) <> v_batch_count
    OR EXISTS (
      SELECT id FROM public.fiscal_invoice_batches WHERE job_id = p_job_id AND status <> 'completed'
      EXCEPT
      SELECT (batch->>'batch_id')::uuid FROM jsonb_array_elements(p_batches) batch
    ) OR EXISTS (
      SELECT (batch->>'batch_id')::uuid FROM jsonb_array_elements(p_batches) batch
      EXCEPT
      SELECT id FROM public.fiscal_invoice_batches WHERE job_id = p_job_id AND status <> 'completed'
    ) THEN RAISE EXCEPTION 'Confirmation payloads must cover each unfinished internal batch exactly once'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.odoo_fiscal_settings WHERE singleton AND tax_treatment_approved) THEN
    RAISE EXCEPTION 'Current vending tax treatment approval is required';
  END IF;
  FOR v_batch_input IN SELECT value FROM jsonb_array_elements(p_batches) LOOP
    SELECT * INTO v_batch FROM public.fiscal_invoice_batches
      WHERE id = (v_batch_input->>'batch_id')::uuid AND job_id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_batch.status NOT IN ('draft_ready', 'confirmation_failed') THEN
      RAISE EXCEPTION 'An internal batch is not ready for confirmation';
    END IF;
    v_payload := v_batch_input->'payload';
    IF jsonb_typeof(v_payload) <> 'object' OR v_payload->>'contract_version' <> '1'
      OR jsonb_typeof(v_payload->'invoices') <> 'array'
      OR jsonb_array_length(v_payload->'invoices') NOT BETWEEN 1 AND 500
      OR v_batch_input->>'payload_sha256' !~ '^[0-9a-f]{64}$'
      OR v_payload->'company'->>'odoo_id' IS DISTINCT FROM v_batch.payload->'company'->>'odoo_id' THEN
      RAISE EXCEPTION 'An internal confirmation payload is invalid';
    END IF;
    v_expected := jsonb_array_length(v_payload->'invoices');
    IF v_expected <> (SELECT count(*) FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id AND status = 'draft')
      OR (SELECT count(DISTINCT invoice->>'platform_invoice_id') FROM jsonb_array_elements(v_payload->'invoices') invoice) <> v_expected
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_payload->'invoices') invoice
        LEFT JOIN public.fiscal_invoice_documents document
          ON document.id = (invoice->>'platform_invoice_id')::uuid AND document.batch_id = v_batch.id
          AND document.status = 'draft' AND document.odoo_move_id = (invoice->>'odoo_move_id')::integer
          AND document.invoice_payload_sha256 = invoice->>'invoice_payload_sha256'
        WHERE document.id IS NULL
      ) THEN RAISE EXCEPTION 'Confirmation payload does not match every draft document in its internal batch'; END IF;
    IF v_batch.confirmation_payload IS NOT NULL AND (
      v_batch.confirmation_payload IS DISTINCT FROM v_payload
      OR v_batch.confirmation_payload_sha256 IS DISTINCT FROM v_batch_input->>'payload_sha256'
    ) THEN RAISE EXCEPTION 'A different confirmation payload is already frozen for this internal batch'; END IF;
    UPDATE public.fiscal_invoice_batches SET confirmation_payload = v_payload,
      confirmation_payload_sha256 = v_batch_input->>'payload_sha256' WHERE id = v_batch.id;
    v_total := v_total + v_expected;
  END LOOP;
  SELECT * INTO v_batch FROM public.fiscal_invoice_batches
    WHERE job_id = p_job_id AND status <> 'completed' ORDER BY batch_sequence LIMIT 1 FOR UPDATE;
  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_bulk_confirmation', p_requested_by, v_batch.confirmation_payload, v_batch.confirmation_payload_sha256)
  RETURNING id INTO v_request_id;
  UPDATE public.fiscal_invoice_documents SET status = 'confirmation_pending'
    WHERE batch_id = v_batch.id AND status = 'draft';
  UPDATE public.fiscal_invoice_batches SET status = 'confirmation_pending', latest_confirmation_request_id = v_request_id,
    failed_at = NULL, error = NULL WHERE id = v_batch.id;
  UPDATE public.fiscal_invoice_jobs SET status = 'confirmation_pending', failed_at = NULL, error = NULL WHERE id = p_job_id;
  RETURN jsonb_build_object('job_id', p_job_id, 'request_id', v_request_id,
    'document_count', v_total, 'batch_count', v_batch_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_odoo_sync_request(p_request_id UUID, p_claim_token UUID, p_result JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.odoo_sync_requests%ROWTYPE;
  v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_next_batch public.fiscal_invoice_batches%ROWTYPE;
  v_job public.fiscal_invoice_jobs%ROWTYPE;
  v_accepted BOOLEAN;
  v_expected INTEGER;
  v_invoice JSONB;
  v_document public.fiscal_invoice_documents%ROWTYPE;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_seen_move_ids INTEGER[] := ARRAY[]::INTEGER[];
  v_next_request_id UUID;
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
  v_accepted := (p_result->>'accepted')::boolean;
  IF v_request.kind NOT IN ('fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation') THEN
    UPDATE public.odoo_sync_requests SET status = CASE WHEN v_accepted THEN 'completed' ELSE 'failed' END,
      completed_at = now(), result = p_result,
      error = CASE WHEN v_accepted THEN NULL ELSE left(COALESCE(p_result->>'error', 'Odoo sync failed'), 5000) END
    WHERE id = p_request_id RETURNING * INTO v_request;
    RETURN to_jsonb(v_request);
  END IF;
  IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
    SELECT * INTO v_batch FROM public.fiscal_invoice_batches WHERE latest_draft_request_id = v_request.id FOR UPDATE;
  ELSE
    SELECT * INTO v_batch FROM public.fiscal_invoice_batches WHERE latest_confirmation_request_id = v_request.id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal invoice batch not found'; END IF;
  SELECT * INTO v_job FROM public.fiscal_invoice_jobs WHERE id = v_batch.job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal invoice job not found'; END IF;
  IF v_accepted THEN
    IF jsonb_typeof(p_result->'invoices') <> 'array' THEN RAISE EXCEPTION 'Invoice results are required'; END IF;
    v_expected := jsonb_array_length(v_request.payload->'invoices');
    IF jsonb_array_length(p_result->'invoices') <> v_expected THEN RAISE EXCEPTION 'Invoice result coverage mismatch'; END IF;
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
          OR jsonb_typeof(v_invoice->'created') <> 'boolean' THEN RAISE EXCEPTION 'Invalid draft invoice result'; END IF;
      ELSE
        IF v_document.status <> 'confirmation_pending' OR v_invoice->>'state' <> 'posted'
          OR NULLIF(btrim(v_invoice->>'name'), '') IS NULL OR jsonb_typeof(v_invoice->'confirmed') <> 'boolean'
          OR v_document.odoo_move_id <> (v_invoice->>'odoo_move_id')::integer THEN RAISE EXCEPTION 'Invalid confirmation result'; END IF;
      END IF;
    END LOOP;
    FOR v_invoice IN SELECT value FROM jsonb_array_elements(p_result->'invoices') LOOP
      IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
        UPDATE public.fiscal_invoice_documents SET status = 'draft',
          odoo_move_id = (v_invoice->>'odoo_move_id')::integer, odoo_state = 'draft',
          odoo_name = NULL, draft_created_at = now(), posted_at = NULL
        WHERE id = (v_invoice->>'platform_invoice_id')::uuid;
      ELSE
        UPDATE public.fiscal_invoice_documents SET status = 'posted', odoo_state = 'posted',
          odoo_name = btrim(v_invoice->>'name'), posted_at = now()
        WHERE id = (v_invoice->>'platform_invoice_id')::uuid;
      END IF;
    END LOOP;
    UPDATE public.odoo_sync_requests SET status = 'completed', completed_at = now(), result = p_result, error = NULL
      WHERE id = p_request_id RETURNING * INTO v_request;
    IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
      UPDATE public.fiscal_invoice_batches SET status = 'draft_ready', draft_completed_at = now(),
        failed_at = NULL, error = NULL WHERE id = v_batch.id;
      SELECT * INTO v_next_batch FROM public.fiscal_invoice_batches
        WHERE job_id = v_job.id AND status = 'queued' ORDER BY batch_sequence LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
        VALUES ('fiscal_invoice_draft_creation', v_job.requested_by, v_next_batch.payload, v_next_batch.payload_sha256)
        RETURNING id INTO v_next_request_id;
        UPDATE public.fiscal_invoice_documents SET status = 'draft_pending'
          WHERE batch_id = v_next_batch.id AND status = 'queued';
        UPDATE public.fiscal_invoice_batches SET status = 'draft_pending', draft_request_id = v_next_request_id,
          latest_draft_request_id = v_next_request_id WHERE id = v_next_batch.id;
      ELSE
        UPDATE public.fiscal_invoice_jobs SET status = 'draft_ready', draft_completed_at = now(),
          failed_at = NULL, error = NULL WHERE id = v_job.id;
      END IF;
    ELSE
      UPDATE public.fiscal_invoice_batches SET status = CASE WHEN EXISTS (
        SELECT 1 FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id AND status = 'draft'
      ) THEN 'draft_ready' ELSE 'completed' END,
        completed_at = CASE WHEN NOT EXISTS (
          SELECT 1 FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id AND status <> 'posted'
        ) THEN now() ELSE NULL END, failed_at = NULL, error = NULL WHERE id = v_batch.id;
      SELECT * INTO v_next_batch FROM public.fiscal_invoice_batches
        WHERE job_id = v_job.id AND status = 'draft_ready' AND batch_sequence > v_batch.batch_sequence
        ORDER BY batch_sequence LIMIT 1 FOR UPDATE;
      IF FOUND AND v_next_batch.confirmation_payload IS NOT NULL THEN
        INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
        VALUES ('fiscal_invoice_bulk_confirmation', v_job.requested_by,
          v_next_batch.confirmation_payload, v_next_batch.confirmation_payload_sha256)
        RETURNING id INTO v_next_request_id;
        UPDATE public.fiscal_invoice_documents SET status = 'confirmation_pending'
          WHERE batch_id = v_next_batch.id AND status = 'draft';
        UPDATE public.fiscal_invoice_batches SET status = 'confirmation_pending',
          latest_confirmation_request_id = v_next_request_id WHERE id = v_next_batch.id;
      ELSIF NOT EXISTS (SELECT 1 FROM public.fiscal_invoice_batches WHERE job_id = v_job.id AND status <> 'completed') THEN
        UPDATE public.fiscal_invoice_jobs SET status = 'completed', completed_at = now(), failed_at = NULL, error = NULL
          WHERE id = v_job.id;
      ELSE
        UPDATE public.fiscal_invoice_jobs SET status = 'draft_ready', failed_at = NULL, error = NULL WHERE id = v_job.id;
      END IF;
    END IF;
  ELSE
    IF v_request.kind = 'fiscal_invoice_draft_creation' THEN
      UPDATE public.fiscal_invoice_documents SET status = 'draft_failed'
        WHERE batch_id = v_batch.id AND status = 'draft_pending';
      UPDATE public.fiscal_invoice_batches SET status = 'failed', failed_at = now(),
        error = left(COALESCE(p_result->>'error', 'Odoo draft creation failed'), 5000) WHERE id = v_batch.id;
      UPDATE public.fiscal_invoice_jobs SET status = 'failed', failed_at = now(),
        error = left(COALESCE(p_result->>'error', 'Odoo draft creation failed'), 5000) WHERE id = v_job.id;
    ELSE
      UPDATE public.fiscal_invoice_documents SET status = 'draft'
        WHERE batch_id = v_batch.id AND status = 'confirmation_pending';
      UPDATE public.fiscal_invoice_batches SET status = 'confirmation_failed', failed_at = now(),
        error = left(COALESCE(p_result->>'error', 'Odoo invoice confirmation failed'), 5000) WHERE id = v_batch.id;
      UPDATE public.fiscal_invoice_jobs SET status = 'confirmation_failed', failed_at = now(),
        error = left(COALESCE(p_result->>'error', 'Odoo invoice confirmation failed'), 5000) WHERE id = v_job.id;
    END IF;
    UPDATE public.odoo_sync_requests SET status = 'failed', completed_at = now(), result = p_result,
      error = left(COALESCE(p_result->>'error', 'Odoo sync failed'), 5000)
    WHERE id = p_request_id RETURNING * INTO v_request;
  END IF;
  RETURN to_jsonb(v_request);
END;
$$;

ALTER TABLE public.fiscal_invoice_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_invoice_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fiscal_invoice_job_progress FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_invoice_jobs FROM service_role;
GRANT SELECT ON public.fiscal_invoice_jobs TO service_role;
GRANT SELECT ON public.fiscal_invoice_job_progress TO service_role;

REVOKE ALL ON FUNCTION public.create_fiscal_invoice_job(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_fiscal_invoice_draft_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_fiscal_invoice_job_confirmation(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_fiscal_invoice_job_source_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fiscal_invoice_job(UUID, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_fiscal_invoice_draft_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_fiscal_invoice_job_confirmation(UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.create_fiscal_invoice_draft_batch(UUID, UUID, UUID, JSONB, TEXT, JSONB) FROM service_role;
REVOKE ALL ON FUNCTION public.retry_fiscal_invoice_draft_batch(UUID, UUID) FROM service_role;
REVOKE ALL ON FUNCTION public.queue_fiscal_invoice_confirmation(UUID, UUID, JSONB, JSONB, TEXT) FROM service_role;
