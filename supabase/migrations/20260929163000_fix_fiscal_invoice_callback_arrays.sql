CREATE OR REPLACE FUNCTION public.complete_odoo_sync_request(p_request_id UUID, p_claim_token UUID, p_result JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.odoo_sync_requests%ROWTYPE;
  v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_accepted BOOLEAN;
  v_expected INTEGER;
  v_invoice JSONB;
  v_document public.fiscal_invoice_documents%ROWTYPE;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_seen_move_ids INTEGER[] := ARRAY[]::INTEGER[];
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
