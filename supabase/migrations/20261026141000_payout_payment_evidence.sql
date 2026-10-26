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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_paid_by AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  v_payment_details := p_source_snapshot->'paymentDetails';
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date
    OR p_total_cents IS NULL OR p_total_cents <= 0 OR NULLIF(btrim(p_payment_reference), '') IS NULL
    OR char_length(btrim(p_payment_reference)) > 200 OR NULLIF(btrim(p_agreement_version), '') IS NULL
    OR jsonb_typeof(p_source_snapshot) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_payment_details) IS DISTINCT FROM 'object'
    OR NULLIF(btrim(v_payment_details->>'recipientLegalName'), '') IS NULL
    OR NULLIF(btrim(v_payment_details->>'recipientTaxId'), '') IS NULL
    OR jsonb_typeof(v_payment_details->'bankDetails') IS DISTINCT FROM 'object'
    OR NULLIF(btrim(v_payment_details #>> '{bankDetails,accountHolderName}'), '') IS NULL
    OR NULLIF(btrim(v_payment_details #>> '{bankDetails,iban}'), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid paid payout input';
  END IF;
  v_payment_details := v_payment_details || jsonb_build_object(
    'paymentReference', btrim(p_payment_reference),
    'paidAt', v_paid_at
  );
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
      paid_at = v_paid_at, paid_by = p_paid_by, payment_reference = btrim(p_payment_reference),
      agreement_version = COALESCE(agreement_version, p_agreement_version),
      contract_acceptance_id = COALESCE(contract_acceptance_id, p_contract_acceptance_id),
      payment_details_snapshot = v_payment_details
    WHERE id = v_settlement.id RETURNING * INTO v_settlement;
  ELSE
    INSERT INTO public.franchisee_payout_settlements(tenant_id, period_month, status, calculated_total_cents,
      paid_total_cents, paid_at, paid_by, payment_reference, agreement_version, contract_acceptance_id,
      source_snapshot, payment_details_snapshot)
    VALUES (p_tenant_id, p_period_month, 'paid', p_total_cents, p_total_cents, v_paid_at, p_paid_by,
      btrim(p_payment_reference), p_agreement_version, p_contract_acceptance_id, p_source_snapshot,
      v_payment_details)
    RETURNING * INTO v_settlement;
  END IF;
  RETURN to_jsonb(v_settlement) || jsonb_build_object('already_paid', false);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_payout_settlement_paid(UUID, DATE, UUID, TEXT, BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_settlement_paid(UUID, DATE, UUID, TEXT, BIGINT, TEXT, UUID, JSONB) TO service_role;
