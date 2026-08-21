ALTER TABLE public.service_action_reports ADD COLUMN action_modes TEXT[];

UPDATE public.service_action_reports SET action_modes = CASE action_kind
  WHEN 'both' THEN ARRAY['cleaning', 'refill']::TEXT[]
  ELSE ARRAY[action_kind]::TEXT[]
END;

ALTER TABLE public.service_action_reports
  ALTER COLUMN action_modes SET NOT NULL,
  ADD CONSTRAINT service_action_reports_action_modes_check CHECK (
    action_modes <@ ARRAY['cleaning', 'refill', 'other']::TEXT[]
    AND cardinality(action_modes) BETWEEN 1 AND 3
    AND cardinality(action_modes) =
      ('cleaning' = ANY(action_modes))::INTEGER
      + ('refill' = ANY(action_modes))::INTEGER
      + ('other' = ANY(action_modes))::INTEGER
  );

CREATE OR REPLACE FUNCTION public.action_kind_for_modes(p_modes TEXT[])
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN 'cleaning' = ANY(p_modes) AND 'refill' = ANY(p_modes) THEN 'both'
    WHEN 'refill' = ANY(p_modes) THEN 'refill'
    WHEN 'cleaning' = ANY(p_modes) THEN 'cleaning'
    ELSE 'other'
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_service_action_report_modes()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.action_modes IS NULL OR (TG_OP = 'UPDATE' AND NEW.action_kind IS DISTINCT FROM OLD.action_kind AND NEW.action_modes IS NOT DISTINCT FROM OLD.action_modes) THEN
    NEW.action_modes := CASE NEW.action_kind
      WHEN 'both' THEN ARRAY['cleaning', 'refill']::TEXT[]
      ELSE ARRAY[NEW.action_kind]::TEXT[]
    END;
  END IF;
  NEW.action_kind := public.action_kind_for_modes(NEW.action_modes);
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_action_reports_10_sync_modes
BEFORE INSERT OR UPDATE OF action_kind, action_modes ON public.service_action_reports
FOR EACH ROW EXECUTE FUNCTION public.sync_service_action_report_modes();

CREATE OR REPLACE FUNCTION public.enforce_service_action_report_mode_details()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'confirmed' AND 'other' = ANY(NEW.action_modes) AND NULLIF(btrim(NEW.notes), '') IS NULL THEN
    RAISE EXCEPTION 'Notes are required for other actions';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_action_reports_20_enforce_mode_details
BEFORE INSERT OR UPDATE OF status, action_modes, notes ON public.service_action_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_service_action_report_mode_details();

CREATE OR REPLACE FUNCTION public.record_service_action_report(
  p_client_uuid UUID,
  p_machine_id UUID,
  p_operator_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_action_kind TEXT,
  p_status TEXT,
  p_notes TEXT,
  p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER,
  p_refill_lines JSONB,
  p_source TEXT,
  p_action_modes TEXT[]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.service_action_reports%ROWTYPE;
  v_kind TEXT;
  v_payload JSONB;
  v_result JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));
  IF p_action_modes IS NULL OR cardinality(p_action_modes) NOT BETWEEN 1 AND 3
    OR NOT p_action_modes <@ ARRAY['cleaning', 'refill', 'other']::TEXT[]
    OR cardinality(p_action_modes) <> (('cleaning' = ANY(p_action_modes))::INTEGER + ('refill' = ANY(p_action_modes))::INTEGER + ('other' = ANY(p_action_modes))::INTEGER)
  THEN RAISE EXCEPTION 'Invalid action modes'; END IF;
  IF 'other' = ANY(p_action_modes) AND p_status = 'confirmed' AND NULLIF(btrim(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Notes are required for other actions';
  END IF;
  v_kind := public.action_kind_for_modes(p_action_modes);
  IF p_action_kind IS DISTINCT FROM v_kind THEN RAISE EXCEPTION 'Action kind does not match action modes'; END IF;
  v_payload := jsonb_build_object(
    'machine_id', p_machine_id, 'operator_id', p_operator_id, 'occurred_at', p_occurred_at,
    'action_kind', v_kind, 'notes', NULLIF(btrim(p_notes), ''),
    'cleaning_material_used', p_cleaning_material_used, 'water_bucket_count', p_water_bucket_count,
    'refill_lines', p_refill_lines, 'source', p_source
  );
  SELECT * INTO v_existing FROM public.service_action_reports WHERE client_uuid = p_client_uuid;
  IF FOUND AND v_existing.status = 'confirmed' THEN
    IF v_existing.action_modes IS DISTINCT FROM p_action_modes OR v_existing.submission_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'Report UUID conflicts with another confirmed action';
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.status, 'provenance_status', v_existing.provenance_status,
      'cleaning_projection_status', v_existing.cleaning_projection_status, 'refill_projection_status', v_existing.refill_projection_status,
      'projection_error', v_existing.projection_error
    );
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.service_action_reports SET action_modes = p_action_modes WHERE id = v_existing.id;
  END IF;
  SELECT public.record_service_action_report(
    p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, v_kind, p_status, p_notes,
    p_cleaning_material_used, p_water_bucket_count, p_refill_lines, p_source
  ) INTO v_result;
  UPDATE public.service_action_reports SET action_modes = p_action_modes WHERE client_uuid = p_client_uuid;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_mobile_service_action_report(
  p_client_uuid UUID, p_machine_id UUID, p_operator_id UUID, p_occurred_at TIMESTAMPTZ,
  p_action_kind TEXT, p_status TEXT, p_notes TEXT, p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER, p_refill_lines JSONB, p_expected_revision INTEGER,
  p_mobile_payload JSONB, p_action_modes TEXT[]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.service_action_reports%ROWTYPE;
  v_kind TEXT;
  v_payload JSONB;
  v_result JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));
  IF p_action_modes IS NULL OR cardinality(p_action_modes) NOT BETWEEN 1 AND 3
    OR NOT p_action_modes <@ ARRAY['cleaning', 'refill', 'other']::TEXT[]
    OR cardinality(p_action_modes) <> (('cleaning' = ANY(p_action_modes))::INTEGER + ('refill' = ANY(p_action_modes))::INTEGER + ('other' = ANY(p_action_modes))::INTEGER)
  THEN RAISE EXCEPTION 'Invalid action modes'; END IF;
  IF 'other' = ANY(p_action_modes) AND p_status = 'confirmed' AND NULLIF(btrim(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Notes are required for other actions';
  END IF;
  v_kind := public.action_kind_for_modes(p_action_modes);
  IF p_action_kind IS DISTINCT FROM v_kind THEN RAISE EXCEPTION 'Action kind does not match action modes'; END IF;
  v_payload := jsonb_build_object(
    'machine_id', p_machine_id, 'operator_id', p_operator_id, 'occurred_at', p_occurred_at,
    'action_kind', v_kind, 'notes', NULLIF(btrim(p_notes), ''),
    'cleaning_material_used', p_cleaning_material_used, 'water_bucket_count', p_water_bucket_count,
    'refill_lines', p_refill_lines, 'source', 'mobile'
  );
  SELECT * INTO v_existing FROM public.service_action_reports WHERE client_uuid = p_client_uuid;
  IF FOUND AND v_existing.status = 'confirmed' THEN
    IF v_existing.operator_id <> p_operator_id OR v_existing.action_modes IS DISTINCT FROM p_action_modes
      OR v_existing.submission_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'Report UUID conflicts with another confirmed action';
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.status, 'provenance_status', v_existing.provenance_status,
      'revision', v_existing.revision, 'projection_error', v_existing.projection_error
    );
  END IF;
  IF v_existing.id IS NOT NULL AND v_existing.status = 'draft' AND p_expected_revision IS DISTINCT FROM v_existing.revision THEN
    IF v_existing.action_modes IS NOT DISTINCT FROM p_action_modes
      AND v_existing.submission_payload IS NOT DISTINCT FROM v_payload
      AND v_existing.mobile_draft_payload IS NOT DISTINCT FROM (p_mobile_payload - 'action_modes') THEN
      RETURN jsonb_build_object(
        'id', v_existing.id, 'status', v_existing.status, 'provenance_status', v_existing.provenance_status,
        'revision', v_existing.revision, 'projection_error', v_existing.projection_error
      );
    END IF;
    RAISE EXCEPTION 'Draft revision conflict';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.service_action_reports SET action_modes = p_action_modes WHERE id = v_existing.id;
  END IF;
  SELECT public.record_mobile_service_action_report(
    p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, v_kind, p_status, p_notes,
    p_cleaning_material_used, p_water_bucket_count, p_refill_lines, p_expected_revision,
    p_mobile_payload - 'action_modes'
  ) INTO v_result;
  UPDATE public.service_action_reports SET action_modes = p_action_modes WHERE client_uuid = p_client_uuid;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.action_kind_for_modes(TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_service_action_report_modes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_service_action_report_mode_details() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_mobile_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, INTEGER, JSONB, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mobile_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, INTEGER, JSONB, TEXT[]) TO service_role;
