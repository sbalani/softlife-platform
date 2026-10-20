CREATE OR REPLACE FUNCTION public.record_revisioned_service_action_report_v2(
  p_client_uuid UUID,
  p_machine_id UUID,
  p_operator_id UUID,
  p_actor_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_action_modes TEXT[],
  p_status TEXT,
  p_notes TEXT,
  p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER,
  p_refill_lines JSONB,
  p_source TEXT,
  p_expected_revision INTEGER,
  p_draft_payload JSONB,
  p_cashbox JSONB DEFAULT NULL,
  p_incident_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_existing_cash_status TEXT;
  v_preserve_restricted_cash BOOLEAN := false;
BEGIN
  IF p_cashbox IS NULL THEN
    SELECT reconciliation.status INTO v_existing_cash_status
    FROM public.service_action_reports report
    JOIN public.service_action_cash_reconciliations reconciliation ON reconciliation.report_id = report.id
    WHERE report.client_uuid = p_client_uuid;
    IF v_existing_cash_status = 'draft'
      AND NOT public.cash_actor_can_access_machine(p_actor_id, p_machine_id, p_occurred_at)
    THEN
      IF p_status = 'confirmed' THEN RAISE EXCEPTION 'Cashbox access is required to confirm this draft'; END IF;
      v_preserve_restricted_cash := true;
    END IF;
  END IF;

  SELECT public.record_revisioned_service_action_report(
    p_client_uuid, p_machine_id, p_operator_id, p_actor_id, p_occurred_at,
    p_action_modes, p_status, p_notes, p_cleaning_material_used,
    p_water_bucket_count, p_refill_lines, p_source, p_expected_revision,
    p_draft_payload, p_incident_ids
  ) INTO v_result;
  IF NOT v_preserve_restricted_cash THEN
    PERFORM public.record_action_report_cashbox((v_result->>'id')::UUID, p_actor_id, p_cashbox);
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_revisioned_service_action_report_v2(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT[], TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, INTEGER, JSONB, JSONB, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_revisioned_service_action_report_v2(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT[], TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, INTEGER, JSONB, JSONB, UUID[]) TO service_role;
