CREATE OR REPLACE FUNCTION public.fail_manufacturing_export_preparation(p_export_id UUID, p_claim_token UUID, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  SELECT * INTO v_export
  FROM public.manufacturing_period_exports
  WHERE id = p_export_id AND status = 'preparing' AND preparation_claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_export.preparation_attempt_count < 3 THEN
    UPDATE public.manufacturing_period_exports SET
      preparation_stage = 'queued', preparation_claim_token = NULL, preparation_lease_until = NULL,
      preparation_error = left(COALESCE(p_error, 'Unknown preparation failure'), 4000)
    WHERE id = p_export_id;
    RETURN true;
  END IF;

  UPDATE public.manufacturing_period_exports SET
    status = 'failed', preparation_stage = 'failed', preparation_claim_token = NULL, preparation_lease_until = NULL,
    preparation_completed_at = now(), preparation_error = left(COALESCE(p_error, 'Unknown preparation failure'), 4000),
    blocked_reasons = jsonb_build_array(jsonb_build_object('problem_code', 'preparation_failed', 'message', left(COALESCE(p_error, 'Unknown preparation failure'), 4000)))
  WHERE id = p_export_id
  RETURNING * INTO v_export;

  INSERT INTO public.alerts (tenant_id, type, severity, machine_id, entity_key, title, message, mobile_notification)
  SELECT NULL, 'manufacturing_preview_failed', 'critical', NULL, v_export.id::TEXT,
    'Manufacturing preview failed', format('The manufacturing preview for %s through %s failed after %s attempts: %s',
      v_export.period_from::DATE, (v_export.period_to - INTERVAL '1 second')::DATE,
      v_export.preparation_attempt_count, v_export.preparation_error), true
  WHERE NOT EXISTS (SELECT 1 FROM public.alerts WHERE type = 'manufacturing_preview_failed' AND entity_key = v_export.id::TEXT AND resolved_at IS NULL);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_manufacturing_export_preparation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_manufacturing_export_preparation(UUID, UUID, TEXT) TO service_role;
