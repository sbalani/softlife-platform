CREATE OR REPLACE FUNCTION public.finalize_unreserved_service_action_photo(
  p_report_id UUID,
  p_actor_id UUID,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_refill_line_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  report_row public.service_action_reports%ROWTYPE;
  existing_attachment public.service_action_attachments%ROWTYPE;
  actor_role TEXT;
  attachment_id UUID;
  used_slots INTEGER;
BEGIN
  SELECT * INTO report_row FROM public.service_action_reports WHERE id = p_report_id FOR UPDATE;
  SELECT role INTO actor_role FROM public.profiles WHERE id = p_actor_id;
  IF report_row.id IS NULL OR actor_role IS NULL OR report_row.status NOT IN ('draft', 'confirmed')
    OR (actor_role <> 'admin' AND report_row.operator_id <> p_actor_id) THEN
    RAISE EXCEPTION 'Action Report not attachable';
  END IF;
  SELECT * INTO existing_attachment FROM public.service_action_attachments WHERE storage_path = p_storage_path;
  IF existing_attachment.id IS NOT NULL THEN
    IF existing_attachment.report_id IS DISTINCT FROM p_report_id
      OR existing_attachment.refill_line_id IS DISTINCT FROM p_refill_line_id
      OR existing_attachment.mime_type IS DISTINCT FROM p_mime_type
      OR existing_attachment.size_bytes IS DISTINCT FROM p_size_bytes THEN
      RAISE EXCEPTION 'Photo completion conflict';
    END IF;
    RETURN existing_attachment.id;
  END IF;
  IF p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic') OR p_size_bytes NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'Invalid photo';
  END IF;
  IF p_refill_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_action_refill_lines WHERE id = p_refill_line_id AND report_id = p_report_id
  ) THEN RAISE EXCEPTION 'Refill line not found'; END IF;
  SELECT
    (SELECT count(*) FROM public.service_action_attachments WHERE report_id = p_report_id AND kind = 'photo')
    + (SELECT count(*) FROM public.service_action_photo_uploads WHERE report_id = p_report_id AND completed_attachment_id IS NULL AND expires_at > now())
  INTO used_slots;
  IF used_slots >= 20 THEN RAISE EXCEPTION 'Photo limit reached'; END IF;
  INSERT INTO public.service_action_attachments (
    report_id, refill_line_id, kind, storage_path, mime_type, size_bytes, created_by
  ) VALUES (
    p_report_id, p_refill_line_id, 'photo', p_storage_path, p_mime_type, p_size_bytes, p_actor_id
  ) RETURNING id INTO attachment_id;
  RETURN attachment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_unreserved_service_action_photo(UUID, UUID, TEXT, TEXT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_unreserved_service_action_photo(UUID, UUID, TEXT, TEXT, BIGINT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.record_mobile_service_action_report(
  p_client_uuid UUID, p_machine_id UUID, p_operator_id UUID, p_occurred_at TIMESTAMPTZ,
  p_action_kind TEXT, p_status TEXT, p_notes TEXT, p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER, p_refill_lines JSONB, p_expected_revision INTEGER,
  p_mobile_payload JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.service_action_reports%ROWTYPE; v_payload JSONB; v_result JSONB; v_attachments JSONB; v_attachment JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));
  v_payload := jsonb_build_object(
    'machine_id', p_machine_id, 'operator_id', p_operator_id, 'occurred_at', p_occurred_at,
    'action_kind', p_action_kind, 'notes', NULLIF(btrim(p_notes), ''),
    'cleaning_material_used', p_cleaning_material_used, 'water_bucket_count', p_water_bucket_count,
    'refill_lines', p_refill_lines, 'source', 'mobile'
  );
  SELECT * INTO v_existing FROM public.service_action_reports WHERE client_uuid = p_client_uuid FOR UPDATE;
  IF NOT FOUND AND (EXISTS (SELECT 1 FROM public.clean_logs WHERE client_uuid = p_client_uuid)
    OR EXISTS (SELECT 1 FROM public.reposiciones WHERE client_uuid = p_client_uuid)) THEN
    RAISE EXCEPTION 'Client UUID already belongs to a legacy service record';
  END IF;
  IF FOUND THEN
    IF v_existing.operator_id <> p_operator_id THEN RAISE EXCEPTION 'Action Report UUID belongs to another operator'; END IF;
    IF v_existing.status = 'confirmed' THEN
      SELECT public.record_service_action_report(
        p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, p_action_kind, p_status,
        p_notes, p_cleaning_material_used, p_water_bucket_count, p_refill_lines, 'mobile'
      ) INTO v_result;
      RETURN v_result || jsonb_build_object('revision', v_existing.revision);
    END IF;
    IF v_existing.status = 'draft' AND p_expected_revision IS DISTINCT FROM v_existing.revision THEN
      IF v_existing.submission_payload = v_payload AND v_existing.mobile_draft_payload = p_mobile_payload THEN
        RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'provenance_status', v_existing.provenance_status, 'revision', v_existing.revision);
      END IF;
      RAISE EXCEPTION 'Draft revision conflict';
    END IF;
    IF v_existing.status = 'draft' AND EXISTS (
      SELECT 1 FROM public.service_action_refill_lines line
      JOIN public.service_action_attachments attachment ON attachment.refill_line_id = line.id
      WHERE line.report_id = v_existing.id
        AND (v_existing.submission_payload->'refill_lines'->(line.line_number - 1))
          IS DISTINCT FROM (v_payload->'refill_lines'->(line.line_number - 1))
    ) THEN RAISE EXCEPTION 'Refill lines cannot change after line photos are attached'; END IF;
  ELSIF p_expected_revision IS NULL OR p_expected_revision NOT IN (0, 1) THEN
    RAISE EXCEPTION 'New drafts must start at revision 0 or 1';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object('id', attachment.id, 'line_number', line.line_number)) INTO v_attachments
    FROM public.service_action_attachments attachment
    JOIN public.service_action_refill_lines line ON line.id = attachment.refill_line_id
    WHERE line.report_id = v_existing.id;
    UPDATE public.service_action_attachments attachment SET refill_line_id = NULL
    FROM public.service_action_refill_lines line
    WHERE attachment.refill_line_id = line.id AND line.report_id = v_existing.id;
  END IF;
  SELECT public.record_service_action_report(
    p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, p_action_kind, p_status,
    p_notes, p_cleaning_material_used, p_water_bucket_count, p_refill_lines, 'mobile'
  ) INTO v_result;
  IF v_attachments IS NOT NULL THEN
    FOR v_attachment IN SELECT value FROM jsonb_array_elements(v_attachments) LOOP
      UPDATE public.service_action_attachments attachment SET refill_line_id = line.id
      FROM public.service_action_refill_lines line
      WHERE attachment.id = (v_attachment->>'id')::UUID
        AND line.report_id = (v_result->>'id')::UUID
        AND line.line_number = (v_attachment->>'line_number')::INTEGER;
    END LOOP;
  END IF;
  UPDATE public.service_action_reports SET
    revision = CASE WHEN v_existing.id IS NULL THEN 1 ELSE revision + 1 END,
    mobile_draft_payload = CASE WHEN p_status = 'draft' THEN p_mobile_payload ELSE NULL END,
    updated_at = now()
  WHERE client_uuid = p_client_uuid
  RETURNING revision INTO p_expected_revision;
  RETURN v_result || jsonb_build_object('revision', p_expected_revision);
END; $$;

REVOKE ALL ON FUNCTION public.record_mobile_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mobile_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, INTEGER, JSONB) TO service_role;
