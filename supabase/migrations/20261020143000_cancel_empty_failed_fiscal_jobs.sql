ALTER TABLE public.fiscal_invoice_jobs
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancelled_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fiscal_invoice_jobs_cancellation_audit_check CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  );

ALTER TABLE public.fiscal_invoice_documents
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  DROP CONSTRAINT fiscal_invoice_documents_preflight_item_id_key,
  DROP CONSTRAINT fiscal_invoice_documents_source_order_id_key,
  ADD CONSTRAINT fiscal_invoice_documents_cancellation_check CHECK (
    cancelled_at IS NULL OR status IN ('draft_failed', 'queued')
  );

CREATE UNIQUE INDEX fiscal_invoice_documents_active_preflight_item_key
  ON public.fiscal_invoice_documents(preflight_item_id) WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX fiscal_invoice_documents_active_source_order_key
  ON public.fiscal_invoice_documents(source_order_id) WHERE cancelled_at IS NULL;

ALTER TABLE public.fiscal_invoice_batches
  DROP CONSTRAINT fiscal_invoice_batches_request_state_check,
  ADD CONSTRAINT fiscal_invoice_batches_request_state_check CHECK (
    (status = 'queued' AND draft_request_id IS NULL AND latest_draft_request_id IS NULL)
    OR (status = 'cancelled' AND (
      (draft_request_id IS NULL AND latest_draft_request_id IS NULL)
      OR (draft_request_id IS NOT NULL AND latest_draft_request_id IS NOT NULL)
    ))
    OR (status NOT IN ('queued', 'cancelled') AND draft_request_id IS NOT NULL AND latest_draft_request_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.require_price_included_fiscal_invoice_batch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.payload->'tax'->>'price_include')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'The vending sales tax must be price-included';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_invoice_batches_require_price_included
BEFORE INSERT ON public.fiscal_invoice_batches
FOR EACH ROW EXECUTE FUNCTION public.require_price_included_fiscal_invoice_batch();

CREATE OR REPLACE FUNCTION public.cancel_empty_failed_fiscal_invoice_job(p_job_id UUID, p_cancelled_by UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.fiscal_invoice_jobs%ROWTYPE;
  v_document_count INTEGER;
BEGIN
  SELECT * INTO v_job FROM public.fiscal_invoice_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'failed' THEN
    RAISE EXCEPTION 'Only a failed fiscal invoice job can be cancelled';
  END IF;
  IF p_cancelled_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_cancelled_by) THEN
    RAISE EXCEPTION 'A valid cancellation actor is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_invoice_documents document
    JOIN public.fiscal_invoice_batches batch ON batch.id = document.batch_id
    WHERE batch.job_id = p_job_id
      AND (document.odoo_move_id IS NOT NULL OR document.odoo_state IS NOT NULL OR document.odoo_name IS NOT NULL
        OR document.draft_created_at IS NOT NULL OR document.posted_at IS NOT NULL
        OR document.status NOT IN ('draft_failed', 'queued'))
  ) THEN
    RAISE EXCEPTION 'A fiscal invoice job with created or active Odoo invoices cannot be cancelled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.odoo_sync_requests request
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(request.result->'invoices') = 'array' THEN request.result->'invoices' ELSE '[]'::jsonb END
    ) invoice
    JOIN public.fiscal_invoice_documents document ON invoice->>'platform_invoice_id' = document.id::text
    JOIN public.fiscal_invoice_batches batch ON batch.id = document.batch_id
    WHERE batch.job_id = p_job_id AND invoice ? 'odoo_move_id' AND invoice->'odoo_move_id' <> 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'A fiscal invoice job whose connector result contains an Odoo identity cannot be cancelled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.odoo_sync_requests request
    JOIN public.fiscal_invoice_batches batch
      ON request.id IN (batch.latest_draft_request_id, batch.latest_confirmation_request_id)
    WHERE batch.job_id = p_job_id AND request.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'A fiscal invoice job with an active Odoo request cannot be cancelled';
  END IF;
  SELECT count(*) INTO v_document_count
  FROM public.fiscal_invoice_documents document
  JOIN public.fiscal_invoice_batches batch ON batch.id = document.batch_id
  WHERE batch.job_id = p_job_id;
  UPDATE public.fiscal_invoice_documents document SET cancelled_at = now()
  FROM public.fiscal_invoice_batches batch
  WHERE batch.id = document.batch_id AND batch.job_id = p_job_id;
  UPDATE public.fiscal_invoice_batches SET status = 'cancelled'
  WHERE job_id = p_job_id AND status IN ('failed', 'queued');
  UPDATE public.fiscal_invoice_jobs SET status = 'cancelled', cancelled_at = now(),
    cancelled_by = p_cancelled_by WHERE id = p_job_id;
  RETURN jsonb_build_object('job_id', p_job_id, 'document_count', v_document_count);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_empty_failed_fiscal_invoice_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_price_included_fiscal_invoice_batch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_empty_failed_fiscal_invoice_job(UUID, UUID) TO service_role;
