ALTER TABLE public.payout_self_bills
  ALTER COLUMN contract_acceptance_id DROP NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.payout_self_bills'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%contract_acceptance_id%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.payout_self_bills DROP CONSTRAINT %I', constraint_name);
  END IF;
END;
$$;

ALTER TABLE public.payout_self_bills
  ADD CONSTRAINT payout_self_bills_contract_acceptance_payload_check CHECK (
    payload #> '{bill,contract_acceptance_id}' IS NOT NULL
    AND payload #>> '{bill,contract_acceptance_id}' IS NOT DISTINCT FROM contract_acceptance_id::text
    AND (contract_version <> 'SL-GESTOR-2026-10-26-v3' OR contract_acceptance_id IS NOT NULL)
  );

ALTER TABLE public.franchisee_payout_settlements
  DROP CONSTRAINT franchisee_payout_settlements_v4_snapshot_check,
  ADD CONSTRAINT franchisee_payout_settlements_v4_snapshot_check CHECK (
    agreement_version IS DISTINCT FROM 'SL-GESTOR-2026-10-27-v4'
    OR public.valid_payout_v4_snapshot(source_snapshot, calculated_total_cents)
  );

CREATE OR REPLACE FUNCTION public.create_payout_self_bill(
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
  v_iva BIGINT;
  v_acceptance_notice JSONB;
BEGIN
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date
    OR p_calculated_total_cents IS NULL OR p_calculated_total_cents <= 0 OR p_draft_only IS NULL
    OR jsonb_typeof(p_source_snapshot) IS DISTINCT FROM 'object' OR p_source_snapshot->>'version' IS DISTINCT FROM '2'
    OR p_source_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(extensions.digest(convert_to(public.canonical_jsonb_text(p_source_snapshot), 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM p_source_snapshot_sha256
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(extensions.digest(convert_to(public.canonical_jsonb_text(p_payload), 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION 'Invalid frozen payout self-bill input';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_requested_by AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_contract_acceptance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.franchisee_contract_acceptances acceptance
    WHERE acceptance.id = p_contract_acceptance_id AND acceptance.tenant_id = p_tenant_id
      AND acceptance.contract_version = 'SL-GESTOR-2026-10-27-v4'
  ) THEN RAISE EXCEPTION 'Contract acceptance does not match the payout tenant'; END IF;
  v_acceptance_notice := p_source_snapshot->'contractAcceptanceNotice';
  IF p_contract_acceptance_id IS NULL AND (
      jsonb_typeof(v_acceptance_notice) IS DISTINCT FROM 'object'
      OR v_acceptance_notice->>'status' IS DISTINCT FROM 'not_accepted'
      OR v_acceptance_notice->>'acknowledgedBy' IS DISTINCT FROM p_requested_by::text
      OR COALESCE(v_acceptance_notice->>'acknowledgedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    ) THEN
    RAISE EXCEPTION 'Missing contract acceptance override evidence';
  ELSIF p_contract_acceptance_id IS NOT NULL AND v_acceptance_notice IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected contract acceptance override evidence';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_period_month::text, 0));
  v_base := (p_payload #>> '{bill,tax_base_cents}')::bigint;
  v_iva := round(v_base::numeric * 21 / 100);
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'schema_version' IS DISTINCT FROM '1'
    OR jsonb_typeof(p_payload->'bill') IS DISTINCT FROM 'object'
    OR p_payload #>> '{bill,platform_bill_id}' IS DISTINCT FROM p_platform_bill_id::text
    OR p_payload #>> '{bill,settlement_id}' IS DISTINCT FROM p_settlement_id::text
    OR p_payload #>> '{bill,tenant_id}' IS DISTINCT FROM p_tenant_id::text
    OR p_payload #>> '{bill,period_month}' IS DISTINCT FROM to_char(p_period_month, 'YYYY-MM')
    OR p_payload #>> '{bill,invoice_date}' IS DISTINCT FROM to_char((p_period_month + interval '1 month')::date, 'YYYY-MM-DD')
    OR p_payload #>> '{bill,currency}' IS DISTINCT FROM 'EUR' OR p_payload #>> '{bill,move_type}' IS DISTINCT FROM 'in_invoice'
    OR char_length(NULLIF(btrim(p_payload #>> '{bill,reference}'), '')) NOT BETWEEN 1 AND 200
    OR NULLIF(btrim(p_payload #>> '{bill,description}'), '') IS NULL
    OR strpos(p_payload #>> '{bill,description}', 'facturación por el destinatario') = 0
    OR jsonb_typeof(p_payload #> '{bill,gross_cents}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload #> '{bill,tax_base_cents}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload #> '{bill,iva_cents}') IS DISTINCT FROM 'number'
    OR v_base <= 0 OR (p_payload #>> '{bill,iva_cents}')::bigint <> v_iva
    OR (p_payload #>> '{bill,gross_cents}')::bigint <> v_base + v_iva
    OR p_calculated_total_cents <> v_base + v_iva
    OR (p_source_snapshot->>'taxBaseCents')::bigint <> v_base
    OR (p_source_snapshot->>'ivaCents')::bigint <> v_iva
    OR (p_source_snapshot->>'totalCents')::bigint <> p_calculated_total_cents
    OR p_payload #>> '{bill,iva_rate_percent}' IS DISTINCT FROM '21'
    OR p_payload #>> '{bill,contract_acceptance_id}' IS DISTINCT FROM p_contract_acceptance_id::text
    OR p_payload #>> '{bill,contract_version}' IS DISTINCT FROM 'SL-GESTOR-2026-10-27-v4'
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
      'SL-GESTOR-2026-10-27-v4', p_contract_acceptance_id, p_source_snapshot)
    RETURNING * INTO v_settlement;
  ELSIF v_settlement.status NOT IN ('pending', 'paid') OR v_settlement.id <> p_settlement_id
    OR v_settlement.calculated_total_cents <> p_calculated_total_cents
    OR v_settlement.agreement_version IS DISTINCT FROM 'SL-GESTOR-2026-10-27-v4'
    OR (v_settlement.contract_acceptance_id IS NOT NULL
      AND v_settlement.contract_acceptance_id IS DISTINCT FROM p_contract_acceptance_id)
    OR v_settlement.source_snapshot IS DISTINCT FROM p_source_snapshot THEN
    RAISE EXCEPTION 'Existing payout settlement does not exactly match the frozen request';
  END IF;
  IF v_settlement.contract_acceptance_id IS NULL AND p_contract_acceptance_id IS NOT NULL THEN
    UPDATE public.franchisee_payout_settlements
    SET contract_acceptance_id = p_contract_acceptance_id
    WHERE id = v_settlement.id
    RETURNING * INTO v_settlement;
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
    p_payload_sha256, p_source_snapshot_sha256, p_calculated_total_cents, v_base, v_iva,
    21, p_contract_acceptance_id, 'SL-GESTOR-2026-10-27-v4', v_request_id)
  RETURNING * INTO v_bill;
  RETURN to_jsonb(v_bill);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_payout_settlement_paid(
  p_tenant_id UUID, p_period_month DATE, p_paid_by UUID, p_payment_reference TEXT,
  p_total_cents BIGINT, p_agreement_version TEXT, p_contract_acceptance_id UUID,
  p_source_snapshot JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement public.franchisee_payout_settlements%ROWTYPE;
  v_paid_at TIMESTAMPTZ := now();
  v_payment_details JSONB;
  v_base BIGINT;
  v_iva BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_paid_by AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  v_payment_details := p_source_snapshot->'paymentDetails';
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date
    OR p_total_cents IS NULL OR p_total_cents <= 0 OR NULLIF(btrim(p_payment_reference), '') IS NULL
    OR char_length(btrim(p_payment_reference)) > 200
    OR p_agreement_version NOT IN ('SL-GESTOR-2026-10-26-v3', 'SL-GESTOR-2026-10-27-v4')
    OR jsonb_typeof(p_source_snapshot) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_payment_details) IS DISTINCT FROM 'object'
    OR NULLIF(btrim(v_payment_details->>'recipientLegalName'), '') IS NULL
    OR NULLIF(btrim(v_payment_details->>'recipientTaxId'), '') IS NULL
    OR jsonb_typeof(v_payment_details->'bankDetails') IS DISTINCT FROM 'object'
    OR NULLIF(btrim(v_payment_details #>> '{bankDetails,accountHolderName}'), '') IS NULL
    OR NULLIF(btrim(v_payment_details #>> '{bankDetails,iban}'), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid paid payout input';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.franchisee_contract_acceptances acceptance
    WHERE acceptance.id = p_contract_acceptance_id AND acceptance.tenant_id = p_tenant_id
      AND acceptance.contract_version = p_agreement_version
  ) THEN RAISE EXCEPTION 'Exact contract acceptance is required'; END IF;
  IF p_agreement_version = 'SL-GESTOR-2026-10-27-v4' THEN
    v_base := (p_source_snapshot->>'taxBaseCents')::bigint;
    v_iva := round(v_base::numeric * 21 / 100);
    IF p_source_snapshot->>'version' IS DISTINCT FROM '2' OR v_base <= 0
      OR (p_source_snapshot->>'ivaCents')::bigint <> v_iva
      OR (p_source_snapshot->>'totalCents')::bigint <> v_base + v_iva
      OR p_total_cents <> v_base + v_iva THEN RAISE EXCEPTION 'Invalid v4 payout amounts'; END IF;
  ELSIF p_source_snapshot->>'version' IS DISTINCT FROM '1'
    OR (p_source_snapshot->>'totalCents')::bigint <> p_total_cents THEN
    RAISE EXCEPTION 'Invalid legacy payout amounts';
  END IF;
  v_payment_details := v_payment_details || jsonb_build_object(
    'paymentReference', btrim(p_payment_reference), 'paidAt', v_paid_at
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_period_month::text, 0));
  SELECT * INTO v_settlement FROM public.franchisee_payout_settlements
    WHERE tenant_id = p_tenant_id AND period_month = p_period_month FOR UPDATE;
  IF FOUND AND v_settlement.status = 'paid' THEN
    IF v_settlement.calculated_total_cents <> p_total_cents OR v_settlement.paid_total_cents <> p_total_cents
      OR v_settlement.payment_reference IS DISTINCT FROM btrim(p_payment_reference)
      OR v_settlement.agreement_version IS DISTINCT FROM p_agreement_version
      OR v_settlement.contract_acceptance_id IS DISTINCT FROM p_contract_acceptance_id THEN
      RAISE EXCEPTION 'Paid payout evidence conflicts with the existing settlement';
    END IF;
    RETURN to_jsonb(v_settlement) || jsonb_build_object('already_paid', true);
  END IF;
  IF FOUND THEN
    IF v_settlement.calculated_total_cents <> p_total_cents
      OR v_settlement.agreement_version IS DISTINCT FROM p_agreement_version
      OR (v_settlement.contract_acceptance_id IS NOT NULL
        AND v_settlement.contract_acceptance_id IS DISTINCT FROM p_contract_acceptance_id)
      OR v_settlement.source_snapshot IS DISTINCT FROM (p_source_snapshot - 'paymentDetails') THEN
      RAISE EXCEPTION 'Paid evidence differs from frozen payout';
    END IF;
    UPDATE public.franchisee_payout_settlements SET status = 'paid', paid_total_cents = p_total_cents,
      paid_at = v_paid_at, paid_by = p_paid_by, payment_reference = btrim(p_payment_reference),
      contract_acceptance_id = COALESCE(contract_acceptance_id, p_contract_acceptance_id),
      payment_details_snapshot = v_payment_details
    WHERE id = v_settlement.id RETURNING * INTO v_settlement;
  ELSE
    IF p_agreement_version <> 'SL-GESTOR-2026-10-27-v4' THEN RAISE EXCEPTION 'New payouts require the current contract'; END IF;
    INSERT INTO public.franchisee_payout_settlements(tenant_id, period_month, status, calculated_total_cents,
      paid_total_cents, paid_at, paid_by, payment_reference, agreement_version, contract_acceptance_id,
      source_snapshot, payment_details_snapshot)
    VALUES (p_tenant_id, p_period_month, 'paid', p_total_cents, p_total_cents, v_paid_at, p_paid_by,
      btrim(p_payment_reference), p_agreement_version, p_contract_acceptance_id,
      p_source_snapshot, v_payment_details)
    RETURNING * INTO v_settlement;
  END IF;
  RETURN to_jsonb(v_settlement) || jsonb_build_object('already_paid', false);
END;
$$;
