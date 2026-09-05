CREATE OR REPLACE FUNCTION public.record_revisioned_service_action_report(
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
  p_incident_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.service_action_reports%ROWTYPE;
  v_kind TEXT;
  v_submission JSONB;
  v_result JSONB;
  v_attachments JSONB;
  v_attachment JSONB;
  v_incident_ids UUID[];
  v_existing_incident_ids UUID[];
  v_revision INTEGER;
  v_actor_role TEXT;
  v_valid_incident_count INTEGER;
  v_now TIMESTAMPTZ := now();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));

  IF p_action_modes IS NULL OR cardinality(p_action_modes) NOT BETWEEN 1 AND 3
    OR NOT p_action_modes <@ ARRAY['cleaning', 'refill', 'other']::TEXT[]
    OR cardinality(p_action_modes) <> (
      ('cleaning' = ANY(p_action_modes))::INTEGER
      + ('refill' = ANY(p_action_modes))::INTEGER
      + ('other' = ANY(p_action_modes))::INTEGER
    )
  THEN RAISE EXCEPTION 'Invalid action modes'; END IF;
  IF p_source NOT IN ('web', 'machine_qr', 'mobile', 'api') THEN RAISE EXCEPTION 'Invalid report source'; END IF;
  IF p_draft_payload IS NULL OR jsonb_typeof(p_draft_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid draft payload'; END IF;

  v_kind := public.action_kind_for_modes(p_action_modes);
  v_incident_ids := ARRAY(
    SELECT DISTINCT incident_id
    FROM unnest(COALESCE(p_incident_ids, ARRAY[]::UUID[])) incident_id
    ORDER BY incident_id
  );
  IF cardinality(v_incident_ids) > 20 THEN RAISE EXCEPTION 'A report can link at most 20 incidents'; END IF;
  v_submission := jsonb_build_object(
    'machine_id', p_machine_id,
    'operator_id', p_operator_id,
    'occurred_at', p_occurred_at,
    'action_kind', v_kind,
    'notes', NULLIF(btrim(p_notes), ''),
    'cleaning_material_used', p_cleaning_material_used,
    'water_bucket_count', p_water_bucket_count,
    'refill_lines', p_refill_lines,
    'source', p_source
  );

  SELECT * INTO v_existing
  FROM public.service_action_reports
  WHERE client_uuid = p_client_uuid
  FOR UPDATE;

  IF v_existing.id IS NULL AND (
    EXISTS (SELECT 1 FROM public.clean_logs WHERE client_uuid = p_client_uuid)
    OR EXISTS (SELECT 1 FROM public.reposiciones WHERE client_uuid = p_client_uuid)
  ) THEN
    RAISE EXCEPTION 'Client UUID already belongs to a legacy service record';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = p_actor_id;
  IF v_actor_role IS NULL OR (p_actor_id <> p_operator_id AND v_actor_role <> 'admin') THEN
    RAISE EXCEPTION 'Action Report access denied';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.operator_id <> p_operator_id THEN RAISE EXCEPTION 'Action Report UUID belongs to another operator'; END IF;
    SELECT COALESCE(array_agg(incident_id ORDER BY incident_id), ARRAY[]::UUID[])
      INTO v_existing_incident_ids
      FROM public.service_action_report_incidents
      WHERE report_id = v_existing.id;

    IF v_existing.status = 'confirmed' THEN
      IF p_expected_revision NOT IN (v_existing.revision, v_existing.revision - 1) THEN
        RAISE EXCEPTION 'Action Report revision conflict';
      END IF;
      SELECT public.record_service_action_report(
        p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, v_kind, p_status,
        p_notes, p_cleaning_material_used, p_water_bucket_count, p_refill_lines,
        p_source, p_action_modes
      ) INTO v_result;
      IF v_existing_incident_ids IS DISTINCT FROM v_incident_ids THEN
        RAISE EXCEPTION 'Confirmed report incident links cannot change';
      END IF;
      RETURN v_result || jsonb_build_object('revision', v_existing.revision);
    END IF;

    IF v_existing.status <> 'draft' THEN RAISE EXCEPTION 'Action Report cannot be edited'; END IF;
    IF p_expected_revision IS DISTINCT FROM v_existing.revision THEN
      IF v_existing.action_modes IS NOT DISTINCT FROM p_action_modes
        AND v_existing.submission_payload IS NOT DISTINCT FROM v_submission
        AND v_existing.mobile_draft_payload IS NOT DISTINCT FROM p_draft_payload
        AND v_existing_incident_ids IS NOT DISTINCT FROM v_incident_ids
      THEN
        RETURN jsonb_build_object(
          'id', v_existing.id,
          'status', v_existing.status,
          'provenance_status', v_existing.provenance_status,
          'revision', v_existing.revision,
          'projection_error', v_existing.projection_error
        );
      END IF;
      RAISE EXCEPTION 'Action Report revision conflict';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.service_action_refill_lines line
      JOIN public.service_action_attachments attachment ON attachment.refill_line_id = line.id
      WHERE line.report_id = v_existing.id
        AND (v_existing.submission_payload->'refill_lines'->(line.line_number - 1))
          IS DISTINCT FROM (v_submission->'refill_lines'->(line.line_number - 1))
    ) THEN
      RAISE EXCEPTION 'Refill lines cannot change after line photos are attached';
    END IF;

    SELECT jsonb_agg(jsonb_build_object('id', attachment.id, 'line_number', line.line_number))
      INTO v_attachments
      FROM public.service_action_attachments attachment
      JOIN public.service_action_refill_lines line ON line.id = attachment.refill_line_id
      WHERE line.report_id = v_existing.id;
    UPDATE public.service_action_attachments attachment
      SET refill_line_id = NULL
      FROM public.service_action_refill_lines line
      WHERE attachment.refill_line_id = line.id AND line.report_id = v_existing.id;
  ELSIF p_expected_revision IS NULL OR p_expected_revision NOT IN (0, 1) THEN
    RAISE EXCEPTION 'New reports must start at revision 0 or 1';
  END IF;

  SELECT public.record_service_action_report(
    p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, v_kind, p_status,
    p_notes, p_cleaning_material_used, p_water_bucket_count, p_refill_lines,
    p_source, p_action_modes
  ) INTO v_result;

  IF v_attachments IS NOT NULL THEN
    FOR v_attachment IN SELECT value FROM jsonb_array_elements(v_attachments) LOOP
      UPDATE public.service_action_attachments attachment
        SET refill_line_id = line.id
        FROM public.service_action_refill_lines line
        WHERE attachment.id = (v_attachment->>'id')::UUID
          AND line.report_id = (v_result->>'id')::UUID
          AND line.line_number = (v_attachment->>'line_number')::INTEGER;
    END LOOP;
  END IF;

  PERFORM incident.id
    FROM public.incidents incident
    WHERE incident.id = ANY(v_incident_ids)
    ORDER BY incident.id
    FOR UPDATE;
  SELECT count(*) INTO v_valid_incident_count
    FROM public.incidents incident
    WHERE incident.id = ANY(v_incident_ids)
      AND incident.scope_kind = 'machine'
      AND incident.machine_id = p_machine_id
      AND incident.status IN ('open', 'in_progress')
      AND (v_actor_role = 'admin' OR public.incident_actor_can_access(incident.id, p_actor_id));
  IF v_valid_incident_count <> cardinality(v_incident_ids) THEN
    RAISE EXCEPTION 'One or more incidents are unavailable for this report';
  END IF;
  DELETE FROM public.service_action_report_incidents WHERE report_id = (v_result->>'id')::UUID;
  INSERT INTO public.service_action_report_incidents (report_id, incident_id, linked_by, closes_incident)
    SELECT (v_result->>'id')::UUID, incident_id, p_actor_id, p_status = 'confirmed'
    FROM unnest(v_incident_ids) incident_id;
  IF p_status = 'confirmed' THEN
    INSERT INTO public.incident_events (incident_id, event_type, actor_id, from_status, to_status, message, metadata)
      SELECT id, 'action_report_linked', p_actor_id, status, 'resolved',
        CASE WHEN NULLIF(btrim(p_notes), '') IS NULL THEN 'Resolved through Action Report.' ELSE 'Resolved through Action Report: ' || btrim(p_notes) END,
        jsonb_build_object('report_id', (v_result->>'id')::UUID)
      FROM public.incidents
      WHERE id = ANY(v_incident_ids) AND status IN ('open', 'in_progress');
    UPDATE public.incidents SET
      status = 'resolved',
      resolution_summary = CASE WHEN NULLIF(btrim(p_notes), '') IS NULL THEN 'Resolved through Action Report.' ELSE 'Resolved through Action Report: ' || btrim(p_notes) END,
      resolved_at = v_now,
      resolved_by = p_actor_id,
      closed_at = v_now,
      closed_by = p_actor_id,
      closure_kind = 'action_report',
      closing_action_report_id = (v_result->>'id')::UUID,
      updated_at = v_now
      WHERE id = ANY(v_incident_ids) AND status IN ('open', 'in_progress');
  END IF;

  UPDATE public.service_action_reports
    SET revision = CASE WHEN v_existing.id IS NULL THEN 1 ELSE revision + 1 END,
        mobile_draft_payload = CASE WHEN p_status = 'draft' THEN p_draft_payload ELSE NULL END,
        updated_at = now()
    WHERE client_uuid = p_client_uuid
    RETURNING revision INTO v_revision;

  RETURN v_result || jsonb_build_object(
    'revision', v_revision,
    'closed_incidents', CASE WHEN p_status = 'confirmed' THEN cardinality(v_incident_ids) ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_revisioned_service_action_report(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT[], TEXT, TEXT, BOOLEAN, INTEGER,
  JSONB, TEXT, INTEGER, JSONB, UUID[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_revisioned_service_action_report(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT[], TEXT, TEXT, BOOLEAN, INTEGER,
  JSONB, TEXT, INTEGER, JSONB, UUID[]
) TO service_role;
