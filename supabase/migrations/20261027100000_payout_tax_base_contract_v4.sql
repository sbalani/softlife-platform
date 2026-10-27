-- Preserve v3 evidence while making v4 the only contract accepted for new payouts.
ALTER TABLE public.franchisee_contract_acceptances
  DROP CONSTRAINT franchisee_contract_acceptances_contract_version_check,
  DROP CONSTRAINT franchisee_contract_acceptances_contract_template_hash_check,
  ADD CONSTRAINT franchisee_contract_acceptances_contract_version_hash_check CHECK (
    (contract_version = 'SL-GESTOR-2026-10-26-v3'
      AND contract_template_hash = '1bcedd5dfba2b85600dae517477171800ebab54b6626677f6cf3a3beefc4e8b5')
    OR
    (contract_version = 'SL-GESTOR-2026-10-27-v4'
      AND contract_template_hash = 'd163fcfccf23e66bab187b1775890adcaad5b19b6f933a8772df6106ac769c0e')
  );

ALTER TABLE public.franchisee_intake_submissions
  DROP CONSTRAINT franchisee_intake_accepted_evidence_complete,
  ADD CONSTRAINT franchisee_intake_accepted_evidence_complete CHECK (
    accepted_at IS NULL OR (
      representative_title IS NOT NULL AND registered_address IS NOT NULL AND installation_address IS NOT NULL
      AND contract_version IS NOT NULL
      AND contract_template_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(canonical_source) = 'object'
      AND canonical_source_sha256 ~ '^[a-f0-9]{64}$' AND pdf_storage_path IS NOT NULL
      AND pdf_sha256 ~ '^[a-f0-9]{64}$' AND download_token_sha256 ~ '^[a-f0-9]{64}$'
      AND ip_audit_hash ~ '^[a-f0-9]{64}$' AND user_agent IS NOT NULL
      AND company_name IS NOT NULL AND contact_email IS NOT NULL AND tax_id IS NOT NULL
      AND (
        (contract_version = 'SL-GESTOR-2026-09-29-v1'
          AND modality IS NOT NULL AND share_percent IS NOT NULL
          AND bank_details_deferred = false AND account_holder_name IS NOT NULL AND iban IS NOT NULL)
        OR
        (contract_version IN ('SL-GESTOR-2026-09-29-v2', 'SL-GESTOR-2026-10-26-v3', 'SL-GESTOR-2026-10-27-v4')
          AND modality IS NULL AND share_percent IS NULL
          AND ((bank_details_deferred = true AND account_holder_name IS NULL AND iban IS NULL AND bic_swift IS NULL)
            OR (bank_details_deferred = false AND account_holder_name IS NOT NULL AND account_holder_name <> '' AND iban IS NOT NULL)))
      )
    )
  );

ALTER TABLE public.franchisee_contract_reminders
  DROP CONSTRAINT franchisee_contract_reminders_contract_version_check,
  ADD CONSTRAINT franchisee_contract_reminders_contract_version_check CHECK (
    contract_version IN ('SL-GESTOR-2026-10-26-v3', 'SL-GESTOR-2026-10-27-v4')
  );

UPDATE public.franchisee_contract_reminders
SET status = 'skipped', skipped_at = now(), claim_token = NULL, lease_until = NULL,
    error = 'Campaña sustituida por la versión contractual vigente', updated_at = now()
WHERE contract_version = 'SL-GESTOR-2026-10-26-v3'
  AND status IN ('pending', 'sending', 'failed');

INSERT INTO public.franchisee_contract_reminders (
  tenant_id, contract_version, due_date, recipient_email, recipient_name,
  status, skipped_at, error
)
SELECT reminder.tenant_id, 'SL-GESTOR-2026-10-27-v4', reminder.due_date,
       reminder.recipient_email, reminder.recipient_name,
       CASE WHEN acceptance.id IS NOT NULL OR reminder.recipient_email IS NULL THEN 'skipped' ELSE 'pending' END,
       CASE WHEN acceptance.id IS NOT NULL OR reminder.recipient_email IS NULL THEN now() END,
       CASE WHEN acceptance.id IS NOT NULL THEN 'El contrato vigente ya estaba aceptado al crear la campaña'
            WHEN reminder.recipient_email IS NULL THEN 'No hay una dirección de correo válida disponible para el recordatorio' END
FROM public.franchisee_contract_reminders reminder
LEFT JOIN public.franchisee_contract_acceptances acceptance
  ON acceptance.tenant_id = reminder.tenant_id
 AND acceptance.contract_version = 'SL-GESTOR-2026-10-27-v4'
WHERE reminder.contract_version = 'SL-GESTOR-2026-10-26-v3'
ON CONFLICT (tenant_id, contract_version) DO NOTHING;

ALTER TABLE public.payout_self_bills
  DROP CONSTRAINT payout_self_bills_contract_version_check,
  DROP CONSTRAINT payout_self_bills_check1,
  ADD CONSTRAINT payout_self_bills_contract_version_check CHECK (
    contract_version IN ('SL-GESTOR-2026-10-26-v3', 'SL-GESTOR-2026-10-27-v4')
  ),
  ADD CONSTRAINT payout_self_bills_tax_calculation_check CHECK (
    (contract_version = 'SL-GESTOR-2026-10-26-v3'
      AND tax_base_cents = round(gross_cents::numeric * 100 / 121))
    OR
    (contract_version = 'SL-GESTOR-2026-10-27-v4'
      AND iva_cents = round(tax_base_cents::numeric * 21 / 100))
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
  IF NOT EXISTS (
    SELECT 1 FROM public.franchisee_contract_acceptances acceptance
    WHERE acceptance.id = p_contract_acceptance_id AND acceptance.tenant_id = p_tenant_id
      AND acceptance.contract_version = 'SL-GESTOR-2026-10-27-v4'
  ) THEN RAISE EXCEPTION 'Exact current contract acceptance is required'; END IF;
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
    OR v_settlement.contract_acceptance_id IS DISTINCT FROM p_contract_acceptance_id
    OR v_settlement.source_snapshot IS DISTINCT FROM p_source_snapshot THEN
    RAISE EXCEPTION 'Existing payout settlement does not exactly match the frozen request';
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

ALTER TABLE public.franchisee_payout_settlements
  DROP CONSTRAINT franchisee_payout_settlements_paid_evidence_check,
  ADD CONSTRAINT franchisee_payout_settlements_paid_evidence_check CHECK (
    status = 'pending'
    OR (
      payment_reference IS NOT NULL AND char_length(btrim(payment_reference)) > 0
      AND agreement_version IS NOT NULL AND char_length(btrim(agreement_version)) > 0
      AND source_snapshot ? 'rows' AND source_snapshot ? 'from' AND source_snapshot ? 'to'
      AND (
        (agreement_version <> 'SL-GESTOR-2026-10-27-v4')
        OR
        (agreement_version = 'SL-GESTOR-2026-10-27-v4' AND contract_acceptance_id IS NOT NULL
          AND source_snapshot->>'version' = '2'
          AND (source_snapshot->>'taxBaseCents')::bigint > 0
          AND (source_snapshot->>'ivaCents')::bigint = round((source_snapshot->>'taxBaseCents')::numeric * 21 / 100)
          AND (source_snapshot->>'totalCents')::bigint = (source_snapshot->>'taxBaseCents')::bigint + (source_snapshot->>'ivaCents')::bigint
          AND paid_total_cents = (source_snapshot->>'totalCents')::bigint)
      )
    )
  );

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
      OR v_settlement.contract_acceptance_id IS DISTINCT FROM p_contract_acceptance_id
      OR v_settlement.source_snapshot IS DISTINCT FROM (p_source_snapshot - 'paymentDetails') THEN
      RAISE EXCEPTION 'Paid evidence differs from frozen payout';
    END IF;
    UPDATE public.franchisee_payout_settlements SET status = 'paid', paid_total_cents = p_total_cents,
      paid_at = v_paid_at, paid_by = p_paid_by, payment_reference = btrim(p_payment_reference),
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
