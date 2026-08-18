ALTER TABLE public.service_action_reports
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN mobile_draft_payload JSONB;

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
    IF v_existing.status = 'draft' AND v_existing.submission_payload IS DISTINCT FROM v_payload AND EXISTS (
      SELECT 1 FROM public.service_action_refill_lines line
      JOIN public.service_action_attachments attachment ON attachment.refill_line_id = line.id
      WHERE line.report_id = v_existing.id
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

CREATE OR REPLACE FUNCTION public.bump_franchisee_scope_for_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles SET scope_version = COALESCE(scope_version, 1) + 1 WHERE tenant_id = NEW.tenant_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET scope_version = COALESCE(scope_version, 1) + 1 WHERE tenant_id = OLD.tenant_id;
    RETURN OLD;
  ELSE
    UPDATE public.profiles SET scope_version = COALESCE(scope_version, 1) + 1 WHERE tenant_id IN (OLD.tenant_id, NEW.tenant_id);
    RETURN NEW;
  END IF;
END; $$;

CREATE TRIGGER machine_franchisee_assignments_bump_mobile_scope
AFTER INSERT OR UPDATE OR DELETE ON public.machine_franchisee_assignments
FOR EACH ROW EXECUTE FUNCTION public.bump_franchisee_scope_for_assignment();

REVOKE ALL ON FUNCTION public.record_mobile_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_franchisee_scope_for_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mobile_service_action_report(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, INTEGER, JSONB) TO service_role;
