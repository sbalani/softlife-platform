ALTER TABLE public.odoo_sync_requests
  DROP CONSTRAINT odoo_sync_requests_kind_check,
  DROP CONSTRAINT odoo_sync_requests_fiscal_payload_check,
  ADD CONSTRAINT odoo_sync_requests_kind_check CHECK (kind IN (
    'stock_snapshot', 'fiscal_product_remediation',
    'fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation', 'fiscal_invoice_sale_link',
    'payout_vendor_bill_draft_creation', 'payout_vendor_bill_posting', 'payout_vendor_bill_pdf_export'
  )),
  ADD CONSTRAINT odoo_sync_requests_fiscal_payload_check CHECK ((
    (kind = 'stock_snapshot' AND payload = '{}'::jsonb AND payload_sha256 IS NULL)
    OR (kind = 'fiscal_product_remediation' AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1' AND jsonb_typeof(payload->'products') = 'array' AND payload_sha256 IS NOT NULL)
    OR (kind IN ('fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation')
      AND payload <> '{}'::jsonb AND payload->>'contract_version' IN ('1', '2')
      AND jsonb_typeof(payload->'company') = 'object' AND jsonb_typeof(payload->'invoices') = 'array'
      AND jsonb_array_length(payload->'invoices') BETWEEN 1 AND 500 AND payload_sha256 IS NOT NULL)
    OR (kind = 'fiscal_invoice_sale_link' AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1' AND payload->>'local_month' ~ '^\d{4}-(0[1-9]|1[0-2])$'
      AND jsonb_typeof(payload->'links') = 'array'
      AND jsonb_array_length(payload->'links') BETWEEN 1 AND 500 AND payload_sha256 IS NULL)
    OR (kind IN ('payout_vendor_bill_draft_creation', 'payout_vendor_bill_posting', 'payout_vendor_bill_pdf_export')
      AND payload <> '{}'::jsonb AND payload->>'schema_version' = '1'
      AND jsonb_typeof(payload->'bill') = 'object' AND payload_sha256 IS NOT NULL)
  ) IS TRUE);

ALTER TABLE public.franchisee_payout_settlements
  ADD COLUMN payment_details_snapshot JSONB
  CHECK (payment_details_snapshot IS NULL OR jsonb_typeof(payment_details_snapshot) = 'object');

DROP INDEX public.odoo_sync_requests_active_kind_idx;
CREATE UNIQUE INDEX odoo_sync_requests_active_kind_idx ON public.odoo_sync_requests(kind)
  WHERE status IN ('pending', 'processing')
    AND kind NOT IN ('payout_vendor_bill_draft_creation', 'payout_vendor_bill_posting', 'payout_vendor_bill_pdf_export');

CREATE TABLE public.payout_self_bills (
  id UUID PRIMARY KEY,
  settlement_id UUID NOT NULL UNIQUE REFERENCES public.franchisee_payout_settlements(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('draft_pending', 'draft', 'post_pending', 'pdf_pending', 'completed', 'failed')),
  draft_only BOOLEAN NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  source_snapshot_sha256 TEXT NOT NULL CHECK (source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  gross_cents BIGINT NOT NULL CHECK (gross_cents > 0),
  tax_base_cents BIGINT NOT NULL CHECK (tax_base_cents > 0),
  iva_cents BIGINT NOT NULL CHECK (iva_cents >= 0),
  iva_rate_percent INTEGER NOT NULL CHECK (iva_rate_percent = 21),
  contract_acceptance_id UUID NOT NULL REFERENCES public.franchisee_contract_acceptances(id) ON DELETE RESTRICT,
  contract_version TEXT NOT NULL CHECK (contract_version = 'SL-GESTOR-2026-10-26-v3'),
  draft_request_id UUID NOT NULL REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  post_request_id UUID REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  pdf_request_id UUID REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  odoo_move_id INTEGER UNIQUE CHECK (odoo_move_id IS NULL OR odoo_move_id > 0),
  odoo_partner_id INTEGER CHECK (odoo_partner_id IS NULL OR odoo_partner_id > 0),
  odoo_journal_id INTEGER CHECK (odoo_journal_id IS NULL OR odoo_journal_id > 0),
  odoo_name TEXT,
  odoo_attachment_id INTEGER UNIQUE CHECK (odoo_attachment_id IS NULL OR odoo_attachment_id > 0),
  pdf_evidence_request_id UUID REFERENCES public.odoo_sync_requests(id) ON DELETE RESTRICT,
  pdf_storage_path TEXT UNIQUE,
  pdf_sha256 TEXT CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_size_bytes INTEGER CHECK (pdf_size_bytes IS NULL OR pdf_size_bytes BETWEEN 1 AND 5242880),
  error TEXT CHECK (error IS NULL OR char_length(error) <= 5000),
  draft_created_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (gross_cents = tax_base_cents + iva_cents),
  CHECK (tax_base_cents = round(gross_cents::numeric * 100 / 121)),
  CHECK ((payload #>> '{bill,platform_bill_id}') = id::text),
  CHECK ((payload #>> '{bill,settlement_id}') = settlement_id::text),
  CHECK ((payload #>> '{bill,tenant_id}') = tenant_id::text),
  CHECK ((payload #>> '{bill,gross_cents}')::bigint = gross_cents),
  CHECK ((payload #>> '{bill,tax_base_cents}')::bigint = tax_base_cents),
  CHECK ((payload #>> '{bill,iva_cents}')::bigint = iva_cents),
  CHECK ((payload #>> '{bill,contract_acceptance_id}') = contract_acceptance_id::text),
  CHECK ((payload #>> '{bill,contract_version}') = contract_version),
  CHECK ((payload #>> '{bill,source_snapshot_sha256}') = source_snapshot_sha256),
  CHECK ((pdf_evidence_request_id IS NULL AND pdf_storage_path IS NULL AND pdf_sha256 IS NULL AND pdf_size_bytes IS NULL)
    OR (pdf_evidence_request_id IS NOT NULL AND pdf_storage_path IS NOT NULL AND pdf_sha256 IS NOT NULL AND pdf_size_bytes IS NOT NULL))
);

CREATE INDEX payout_self_bills_tenant_created_idx ON public.payout_self_bills(tenant_id, created_at DESC);
CREATE UNIQUE INDEX payout_self_bills_active_draft_request_idx ON public.payout_self_bills(draft_request_id);
CREATE UNIQUE INDEX payout_self_bills_active_post_request_idx ON public.payout_self_bills(post_request_id) WHERE post_request_id IS NOT NULL;
CREATE UNIQUE INDEX payout_self_bills_active_pdf_request_idx ON public.payout_self_bills(pdf_request_id) WHERE pdf_request_id IS NOT NULL;

CREATE FUNCTION public.protect_payout_self_bill_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.settlement_id IS DISTINCT FROM OLD.settlement_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.draft_only IS DISTINCT FROM OLD.draft_only
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
    OR NEW.source_snapshot_sha256 IS DISTINCT FROM OLD.source_snapshot_sha256
    OR NEW.gross_cents IS DISTINCT FROM OLD.gross_cents OR NEW.tax_base_cents IS DISTINCT FROM OLD.tax_base_cents
    OR NEW.iva_cents IS DISTINCT FROM OLD.iva_cents OR NEW.iva_rate_percent IS DISTINCT FROM OLD.iva_rate_percent
    OR NEW.contract_acceptance_id IS DISTINCT FROM OLD.contract_acceptance_id
    OR NEW.contract_version IS DISTINCT FROM OLD.contract_version OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Payout self-bill source fields are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_payout_self_bill_source BEFORE UPDATE ON public.payout_self_bills
FOR EACH ROW EXECUTE FUNCTION public.protect_payout_self_bill_source();

ALTER TABLE public.payout_self_bills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_self_bills FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payout_self_bills TO authenticated, service_role;
GRANT INSERT, UPDATE ON public.payout_self_bills TO service_role;
CREATE POLICY payout_self_bills_read ON public.payout_self_bills FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id() OR public.is_current_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payout-self-bills', 'payout-self-bills', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['application/pdf'];

CREATE FUNCTION public.create_payout_self_bill(
  p_platform_bill_id UUID, p_settlement_id UUID, p_tenant_id UUID, p_period_month DATE,
  p_requested_by UUID, p_calculated_total_cents BIGINT, p_source_snapshot JSONB,
  p_source_snapshot_sha256 TEXT, p_contract_acceptance_id UUID,
  p_payload JSONB, p_payload_sha256 TEXT, p_draft_only BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement public.franchisee_payout_settlements%ROWTYPE;
  v_bill public.payout_self_bills%ROWTYPE;
  v_request_id UUID;
  v_base BIGINT;
BEGIN
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date
    OR p_calculated_total_cents IS NULL OR p_calculated_total_cents <= 0 OR p_draft_only IS NULL
    OR jsonb_typeof(p_source_snapshot) IS DISTINCT FROM 'object' OR p_source_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(extensions.digest(convert_to(public.canonical_jsonb_text(p_source_snapshot), 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM p_source_snapshot_sha256
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(extensions.digest(convert_to(public.canonical_jsonb_text(p_payload), 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION 'Invalid frozen payout self-bill input';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_requested_by AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.franchisee_contract_acceptances acceptance
    WHERE acceptance.id = p_contract_acceptance_id AND acceptance.tenant_id = p_tenant_id
      AND acceptance.contract_version = 'SL-GESTOR-2026-10-26-v3'
  ) THEN RAISE EXCEPTION 'Exact current v3 contract acceptance is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_period_month::text, 0));
  v_base := round(p_calculated_total_cents::numeric * 100 / 121);
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'schema_version' IS DISTINCT FROM '1'
    OR jsonb_typeof(p_payload->'bill') IS DISTINCT FROM 'object'
    OR p_payload #>> '{bill,platform_bill_id}' IS DISTINCT FROM p_platform_bill_id::text
    OR p_payload #>> '{bill,settlement_id}' IS DISTINCT FROM p_settlement_id::text
    OR p_payload #>> '{bill,tenant_id}' IS DISTINCT FROM p_tenant_id::text
    OR p_payload #>> '{bill,period_month}' IS DISTINCT FROM to_char(p_period_month, 'YYYY-MM')
    OR p_payload #>> '{bill,invoice_date}' IS DISTINCT FROM to_char((p_period_month + interval '1 month - 1 day')::date, 'YYYY-MM-DD')
    OR p_payload #>> '{bill,currency}' IS DISTINCT FROM 'EUR' OR p_payload #>> '{bill,move_type}' IS DISTINCT FROM 'in_invoice'
    OR char_length(NULLIF(btrim(p_payload #>> '{bill,reference}'), '')) NOT BETWEEN 1 AND 200
    OR NULLIF(btrim(p_payload #>> '{bill,description}'), '') IS NULL
    OR strpos(p_payload #>> '{bill,description}', 'facturación por el destinatario') = 0
    OR jsonb_typeof(p_payload #> '{bill,gross_cents}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload #> '{bill,tax_base_cents}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload #> '{bill,iva_cents}') IS DISTINCT FROM 'number'
    OR (p_payload #>> '{bill,gross_cents}')::bigint <> p_calculated_total_cents
    OR (p_payload #>> '{bill,tax_base_cents}')::bigint <> v_base
    OR (p_payload #>> '{bill,iva_cents}')::bigint <> p_calculated_total_cents - v_base
    OR p_payload #>> '{bill,iva_rate_percent}' IS DISTINCT FROM '21'
    OR p_payload #>> '{bill,contract_acceptance_id}' IS DISTINCT FROM p_contract_acceptance_id::text
    OR p_payload #>> '{bill,contract_version}' IS DISTINCT FROM 'SL-GESTOR-2026-10-26-v3'
    OR p_payload #>> '{bill,source_snapshot_sha256}' IS DISTINCT FROM p_source_snapshot_sha256
    OR NULLIF(btrim(p_payload #>> '{bill,vendor,legal_name}'), '') IS NULL
    OR NULLIF(btrim(p_payload #>> '{bill,vendor,tax_id}'), '') IS NULL
    OR NULLIF(btrim(p_payload #>> '{bill,vendor,email}'), '') IS NULL
    OR NULLIF(btrim(p_payload #>> '{bill,vendor,address_line_1}'), '') IS NULL
    OR NULLIF(btrim(p_payload #>> '{bill,vendor,postal_code}'), '') IS NULL
    OR NULLIF(btrim(p_payload #>> '{bill,vendor,city}'), '') IS NULL
    OR NULLIF(btrim(p_payload #>> '{bill,vendor,province}'), '') IS NULL
    OR p_payload #>> '{bill,vendor,country_code}' IS DISTINCT FROM 'ES' THEN
    RAISE EXCEPTION 'Payout self-bill payload does not match frozen source';
  END IF;

  SELECT * INTO v_settlement FROM public.franchisee_payout_settlements
    WHERE tenant_id = p_tenant_id AND period_month = p_period_month FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.franchisee_payout_settlements(id, tenant_id, period_month, status,
      calculated_total_cents, agreement_version, contract_acceptance_id, source_snapshot)
    VALUES (p_settlement_id, p_tenant_id, p_period_month, 'pending', p_calculated_total_cents,
      'SL-GESTOR-2026-10-26-v3', p_contract_acceptance_id, p_source_snapshot)
    RETURNING * INTO v_settlement;
  ELSIF v_settlement.status NOT IN ('pending', 'paid') OR v_settlement.id <> p_settlement_id OR v_settlement.calculated_total_cents <> p_calculated_total_cents
    OR v_settlement.source_snapshot IS DISTINCT FROM p_source_snapshot THEN
    RAISE EXCEPTION 'Existing pending payout settlement does not exactly match the frozen request';
  END IF;
  SELECT * INTO v_bill FROM public.payout_self_bills WHERE settlement_id = v_settlement.id FOR UPDATE;
  IF FOUND THEN
    IF v_bill.id = p_platform_bill_id AND v_bill.payload = p_payload AND v_bill.payload_sha256 = p_payload_sha256
      AND v_bill.draft_only = p_draft_only THEN RETURN to_jsonb(v_bill); END IF;
    RAISE EXCEPTION 'A different payout self-bill is already frozen for this settlement';
  END IF;
  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('payout_vendor_bill_draft_creation', p_requested_by, p_payload, p_payload_sha256)
  RETURNING id INTO v_request_id;
  INSERT INTO public.payout_self_bills(id, settlement_id, tenant_id, status, draft_only, payload,
    payload_sha256, source_snapshot_sha256, gross_cents, tax_base_cents, iva_cents,
    iva_rate_percent, contract_acceptance_id, contract_version, draft_request_id)
  VALUES (p_platform_bill_id, v_settlement.id, p_tenant_id, 'draft_pending', p_draft_only, p_payload,
    p_payload_sha256, p_source_snapshot_sha256, p_calculated_total_cents, v_base,
    p_calculated_total_cents - v_base, 21, p_contract_acceptance_id,
    'SL-GESTOR-2026-10-26-v3', v_request_id)
  RETURNING * INTO v_bill;
  RETURN to_jsonb(v_bill);
END;
$$;

CREATE FUNCTION public.post_payout_self_bill(p_self_bill_id UUID, p_requested_by UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill public.payout_self_bills%ROWTYPE; v_payload JSONB; v_hash TEXT; v_request_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_requested_by AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT * INTO v_bill FROM public.payout_self_bills WHERE id = p_self_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout self-bill not found'; END IF;
  IF v_bill.status IN ('post_pending', 'pdf_pending', 'completed') THEN RETURN to_jsonb(v_bill); END IF;
  IF v_bill.status <> 'draft' OR v_bill.odoo_move_id IS NULL THEN RAISE EXCEPTION 'Only a draft self-bill can be posted'; END IF;
  v_payload := jsonb_build_object('schema_version', 1, 'bill', jsonb_build_object(
    'platform_bill_id', v_bill.id, 'odoo_move_id', v_bill.odoo_move_id, 'payload_sha256', v_bill.payload_sha256));
  v_hash := encode(extensions.digest(convert_to(public.canonical_jsonb_text(v_payload), 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('payout_vendor_bill_posting', p_requested_by, v_payload, v_hash) RETURNING id INTO v_request_id;
  UPDATE public.payout_self_bills SET status = 'post_pending', post_request_id = v_request_id, error = NULL
    WHERE id = v_bill.id RETURNING * INTO v_bill;
  RETURN to_jsonb(v_bill);
END;
$$;

CREATE FUNCTION public.retry_payout_self_bill(p_self_bill_id UUID, p_requested_by UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill public.payout_self_bills%ROWTYPE; v_previous public.odoo_sync_requests%ROWTYPE; v_request_id UUID; v_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_requested_by AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT * INTO v_bill FROM public.payout_self_bills WHERE id = p_self_bill_id FOR UPDATE;
  IF NOT FOUND OR v_bill.status <> 'failed' THEN RAISE EXCEPTION 'Only a failed self-bill can be retried'; END IF;
  SELECT * INTO v_previous FROM public.odoo_sync_requests WHERE id IN (v_bill.pdf_request_id, v_bill.post_request_id, v_bill.draft_request_id)
    AND status = 'failed' ORDER BY requested_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Failed payout self-bill request not found'; END IF;
  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
    VALUES (v_previous.kind, p_requested_by, v_previous.payload, v_previous.payload_sha256) RETURNING id INTO v_request_id;
  v_status := CASE v_previous.kind WHEN 'payout_vendor_bill_draft_creation' THEN 'draft_pending'
    WHEN 'payout_vendor_bill_posting' THEN 'post_pending' ELSE 'pdf_pending' END;
  UPDATE public.payout_self_bills SET status = v_status, error = NULL,
    draft_request_id = CASE WHEN v_previous.kind = 'payout_vendor_bill_draft_creation' THEN v_request_id ELSE draft_request_id END,
    post_request_id = CASE WHEN v_previous.kind = 'payout_vendor_bill_posting' THEN v_request_id ELSE post_request_id END,
    pdf_request_id = CASE WHEN v_previous.kind = 'payout_vendor_bill_pdf_export' THEN v_request_id ELSE pdf_request_id END
  WHERE id = v_bill.id RETURNING * INTO v_bill;
  RETURN to_jsonb(v_bill);
END;
$$;

CREATE FUNCTION public.mark_payout_settlement_paid(
  p_tenant_id UUID, p_period_month DATE, p_paid_by UUID, p_payment_reference TEXT,
  p_total_cents BIGINT, p_agreement_version TEXT, p_contract_acceptance_id UUID,
  p_source_snapshot JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_settlement public.franchisee_payout_settlements%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_paid_by AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date
    OR p_total_cents IS NULL OR p_total_cents <= 0 OR NULLIF(btrim(p_payment_reference), '') IS NULL
    OR char_length(btrim(p_payment_reference)) > 200 OR NULLIF(btrim(p_agreement_version), '') IS NULL
    OR jsonb_typeof(p_source_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid paid payout input';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_period_month::text, 0));
  SELECT * INTO v_settlement FROM public.franchisee_payout_settlements
    WHERE tenant_id = p_tenant_id AND period_month = p_period_month FOR UPDATE;
  IF FOUND AND v_settlement.status = 'paid' THEN
    IF v_settlement.calculated_total_cents <> p_total_cents
      OR v_settlement.paid_total_cents <> p_total_cents
      OR v_settlement.payment_reference IS DISTINCT FROM btrim(p_payment_reference)
      OR v_settlement.agreement_version IS DISTINCT FROM p_agreement_version THEN
      RAISE EXCEPTION 'Paid payout evidence conflicts with the existing settlement';
    END IF;
    RETURN to_jsonb(v_settlement) || jsonb_build_object('already_paid', true);
  END IF;
  IF FOUND THEN
    IF v_settlement.calculated_total_cents <> p_total_cents THEN RAISE EXCEPTION 'Paid amount differs from frozen payout'; END IF;
    UPDATE public.franchisee_payout_settlements SET status = 'paid', paid_total_cents = p_total_cents,
      paid_at = now(), paid_by = p_paid_by, payment_reference = btrim(p_payment_reference),
      agreement_version = COALESCE(agreement_version, p_agreement_version),
      contract_acceptance_id = COALESCE(contract_acceptance_id, p_contract_acceptance_id),
      payment_details_snapshot = p_source_snapshot->'paymentDetails'
    WHERE id = v_settlement.id RETURNING * INTO v_settlement;
  ELSE
    INSERT INTO public.franchisee_payout_settlements(tenant_id, period_month, status, calculated_total_cents,
      paid_total_cents, paid_at, paid_by, payment_reference, agreement_version, contract_acceptance_id,
      source_snapshot, payment_details_snapshot)
    VALUES (p_tenant_id, p_period_month, 'paid', p_total_cents, p_total_cents, now(), p_paid_by,
      btrim(p_payment_reference), p_agreement_version, p_contract_acceptance_id, p_source_snapshot,
      p_source_snapshot->'paymentDetails')
    RETURNING * INTO v_settlement;
  END IF;
  RETURN to_jsonb(v_settlement) || jsonb_build_object('already_paid', false);
END;
$$;

CREATE FUNCTION public.record_payout_self_bill_pdf(
  p_self_bill_id UUID, p_request_id UUID, p_claim_token UUID, p_odoo_move_id INTEGER,
  p_odoo_attachment_id INTEGER, p_storage_path TEXT, p_pdf_sha256 TEXT, p_pdf_size_bytes INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.odoo_sync_requests%ROWTYPE;
  v_bill public.payout_self_bills%ROWTYPE;
BEGIN
  IF p_odoo_move_id IS NULL OR p_odoo_move_id <= 0 OR p_odoo_attachment_id IS NULL OR p_odoo_attachment_id <= 0
    OR p_pdf_sha256 !~ '^[a-f0-9]{64}$' OR p_pdf_size_bytes NOT BETWEEN 1 AND 5242880
    OR p_storage_path IS DISTINCT FROM p_self_bill_id::text || '/' || p_pdf_sha256 || '.pdf' THEN
    RAISE EXCEPTION 'Invalid payout PDF evidence';
  END IF;
  SELECT * INTO v_request FROM public.odoo_sync_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO v_bill FROM public.payout_self_bills WHERE id = p_self_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout self-bill not found'; END IF;
  IF v_request.id IS NULL OR v_request.kind <> 'payout_vendor_bill_pdf_export'
    OR v_request.status <> 'processing' OR v_request.claim_token IS DISTINCT FROM p_claim_token
    OR v_bill.status <> 'pdf_pending' OR v_bill.pdf_request_id IS DISTINCT FROM p_request_id
    OR v_bill.odoo_move_id IS DISTINCT FROM p_odoo_move_id
    OR v_request.payload #>> '{bill,platform_bill_id}' IS DISTINCT FROM p_self_bill_id::text
    OR (v_request.payload #>> '{bill,odoo_move_id}')::integer IS DISTINCT FROM p_odoo_move_id
    OR v_request.payload #>> '{bill,payload_sha256}' IS DISTINCT FROM v_bill.payload_sha256 THEN
    RAISE EXCEPTION 'Payout PDF request lease is stale' USING ERRCODE = 'P0001';
  END IF;
  IF v_bill.pdf_evidence_request_id = p_request_id THEN
    IF v_bill.odoo_attachment_id IS DISTINCT FROM p_odoo_attachment_id
      OR v_bill.pdf_storage_path IS DISTINCT FROM p_storage_path
      OR v_bill.pdf_sha256 IS DISTINCT FROM p_pdf_sha256
      OR v_bill.pdf_size_bytes IS DISTINCT FROM p_pdf_size_bytes THEN
      RAISE EXCEPTION 'Different PDF evidence is already stored for this request' USING ERRCODE = 'P0001';
    END IF;
    RETURN to_jsonb(v_bill);
  END IF;
  UPDATE public.payout_self_bills SET
    odoo_attachment_id = p_odoo_attachment_id,
    pdf_evidence_request_id = p_request_id,
    pdf_storage_path = p_storage_path,
    pdf_sha256 = p_pdf_sha256,
    pdf_size_bytes = p_pdf_size_bytes
  WHERE id = p_self_bill_id RETURNING * INTO v_bill;
  RETURN to_jsonb(v_bill);
END;
$$;

CREATE FUNCTION public.process_payout_self_bill_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill public.payout_self_bills%ROWTYPE; v_result JSONB; v_payload JSONB; v_hash TEXT; v_request_id UUID;
BEGIN
  IF OLD.kind NOT IN ('payout_vendor_bill_draft_creation', 'payout_vendor_bill_posting', 'payout_vendor_bill_pdf_export')
    OR OLD.status <> 'processing' OR NEW.status NOT IN ('completed', 'failed') THEN RETURN NEW; END IF;
  IF OLD.kind = 'payout_vendor_bill_draft_creation' THEN
    SELECT * INTO v_bill FROM public.payout_self_bills WHERE draft_request_id = OLD.id FOR UPDATE;
  ELSIF OLD.kind = 'payout_vendor_bill_posting' THEN
    SELECT * INTO v_bill FROM public.payout_self_bills WHERE post_request_id = OLD.id FOR UPDATE;
  ELSE
    SELECT * INTO v_bill FROM public.payout_self_bills WHERE pdf_request_id = OLD.id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout self-bill for request not found'; END IF;
  IF NEW.status = 'failed' THEN
    UPDATE public.payout_self_bills SET status = 'failed', error = left(COALESCE(NEW.error, 'Odoo sync failed'), 5000) WHERE id = v_bill.id;
    RETURN NEW;
  END IF;
  v_result := NEW.result->'bill';
  IF NEW.result->>'accepted' IS DISTINCT FROM 'true' OR jsonb_typeof(v_result) IS DISTINCT FROM 'object'
    OR v_result->>'platform_bill_id' IS DISTINCT FROM v_bill.id::text THEN RAISE EXCEPTION 'Payout self-bill result identity mismatch'; END IF;
  IF OLD.kind = 'payout_vendor_bill_draft_creation' THEN
    IF v_bill.status <> 'draft_pending' OR v_result->>'payload_sha256' IS DISTINCT FROM v_bill.payload_sha256
      OR v_result->>'state' IS DISTINCT FROM 'draft' OR jsonb_typeof(v_result->'created') IS DISTINCT FROM 'boolean'
      OR COALESCE((v_result->>'odoo_move_id')::integer, 0) <= 0 OR COALESCE((v_result->>'odoo_partner_id')::integer, 0) <= 0
      OR COALESCE((v_result->>'odoo_journal_id')::integer, 0) <= 0 OR (v_result->>'amount_total_cents')::bigint IS DISTINCT FROM v_bill.gross_cents
      OR EXISTS (SELECT 1 FROM public.payout_self_bills other WHERE other.odoo_move_id = (v_result->>'odoo_move_id')::integer AND other.id <> v_bill.id)
    THEN RAISE EXCEPTION 'Invalid payout draft result'; END IF;
    UPDATE public.payout_self_bills SET status = CASE WHEN draft_only THEN 'draft' ELSE 'post_pending' END,
      odoo_move_id = (v_result->>'odoo_move_id')::integer, odoo_partner_id = (v_result->>'odoo_partner_id')::integer,
      odoo_journal_id = (v_result->>'odoo_journal_id')::integer, draft_created_at = now(), error = NULL
      WHERE id = v_bill.id RETURNING * INTO v_bill;
    IF NOT v_bill.draft_only THEN
      v_payload := jsonb_build_object('schema_version', 1, 'bill', jsonb_build_object(
        'platform_bill_id', v_bill.id, 'odoo_move_id', v_bill.odoo_move_id, 'payload_sha256', v_bill.payload_sha256));
      v_hash := encode(extensions.digest(convert_to(public.canonical_jsonb_text(v_payload), 'UTF8'), 'sha256'), 'hex');
      INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
      VALUES ('payout_vendor_bill_posting', OLD.requested_by, v_payload, v_hash) RETURNING id INTO v_request_id;
      UPDATE public.payout_self_bills SET post_request_id = v_request_id WHERE id = v_bill.id;
    END IF;
  ELSIF OLD.kind = 'payout_vendor_bill_posting' THEN
    IF v_bill.status <> 'post_pending' OR (v_result->>'odoo_move_id')::integer IS DISTINCT FROM v_bill.odoo_move_id
      OR v_result->>'payload_sha256' IS DISTINCT FROM v_bill.payload_sha256 OR v_result->>'state' IS DISTINCT FROM 'posted'
      OR NULLIF(btrim(v_result->>'name'), '') IS NULL OR jsonb_typeof(v_result->'posted') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'Invalid payout posting result'; END IF;
    UPDATE public.payout_self_bills SET status = 'pdf_pending', odoo_name = btrim(v_result->>'name'), posted_at = now(), error = NULL
      WHERE id = v_bill.id RETURNING * INTO v_bill;
    v_payload := jsonb_build_object('schema_version', 1, 'bill', jsonb_build_object(
      'platform_bill_id', v_bill.id, 'odoo_move_id', v_bill.odoo_move_id,
      'payload_sha256', v_bill.payload_sha256, 'odoo_name', v_bill.odoo_name));
    v_hash := encode(extensions.digest(convert_to(public.canonical_jsonb_text(v_payload), 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
    VALUES ('payout_vendor_bill_pdf_export', OLD.requested_by, v_payload, v_hash) RETURNING id INTO v_request_id;
    UPDATE public.payout_self_bills SET pdf_request_id = v_request_id WHERE id = v_bill.id;
  ELSE
    IF v_bill.status <> 'pdf_pending' OR (v_result->>'odoo_move_id')::integer IS DISTINCT FROM v_bill.odoo_move_id
      OR v_result->>'payload_sha256' IS DISTINCT FROM v_bill.payload_sha256 OR v_result->>'state' IS DISTINCT FROM 'posted'
       OR COALESCE((v_result->>'odoo_attachment_id')::integer, 0) <= 0
       OR v_bill.pdf_evidence_request_id IS DISTINCT FROM OLD.id OR v_bill.pdf_storage_path IS NULL
      OR v_result->>'pdf_sha256' IS DISTINCT FROM v_bill.pdf_sha256
      OR (v_result->>'pdf_size_bytes')::integer IS DISTINCT FROM v_bill.pdf_size_bytes
      OR (v_result->>'odoo_attachment_id')::integer IS DISTINCT FROM v_bill.odoo_attachment_id
    THEN RAISE EXCEPTION 'Payout PDF result does not match uploaded evidence'; END IF;
    UPDATE public.payout_self_bills SET status = 'completed', completed_at = now(), error = NULL WHERE id = v_bill.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER process_payout_self_bill_completion BEFORE UPDATE OF status ON public.odoo_sync_requests
FOR EACH ROW EXECUTE FUNCTION public.process_payout_self_bill_completion();

REVOKE ALL ON FUNCTION public.create_payout_self_bill(UUID, UUID, UUID, DATE, UUID, BIGINT, JSONB, TEXT, UUID, JSONB, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_payout_self_bill(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_payout_self_bill(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_payout_settlement_paid(UUID, DATE, UUID, TEXT, BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_payout_self_bill_pdf(UUID, UUID, UUID, INTEGER, INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payout_self_bill(UUID, UUID, UUID, DATE, UUID, BIGINT, JSONB, TEXT, UUID, JSONB, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_payout_self_bill(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_payout_self_bill(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payout_settlement_paid(UUID, DATE, UUID, TEXT, BIGINT, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payout_self_bill_pdf(UUID, UUID, UUID, INTEGER, INTEGER, TEXT, TEXT, INTEGER) TO service_role;
