CREATE INDEX IF NOT EXISTS service_action_reports_owner_status_updated_idx
  ON public.service_action_reports (operator_id, status, updated_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.mcp_read_action_reports(
  p_actor_id UUID,
  p_status TEXT,
  p_machine_id UUID,
  p_offset INTEGER,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_tenant_id UUID;
  v_result JSONB;
BEGIN
  SELECT CASE WHEN profile.role IN ('admin', 'franchisee') THEN profile.role ELSE 'operator' END,
    profile.tenant_id
  INTO v_role, v_tenant_id
  FROM public.profiles profile
  WHERE profile.id = p_actor_id;

  IF v_role IS NULL
    OR p_status IS NULL
    OR p_status NOT IN ('draft', 'confirmed', 'voided', 'all')
    OR p_offset IS NULL
    OR p_offset NOT BETWEEN 0 AND 10000
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid Action Report query';
  END IF;

  SELECT COALESCE(
    jsonb_agg((to_jsonb(report_row) - 'sort_updated_at') ORDER BY report_row.sort_updated_at DESC, report_row.report_id DESC),
    '[]'::JSONB
  )
  INTO v_result
  FROM (
    SELECT report.id AS report_id,
      report.machine_id,
      COALESCE(machine.display_name, machine.name) AS machine_name,
      machine.device_imei AS machine_imei,
      owner.full_name AS operator_name,
      report.status,
      report.revision,
      report.action_kind,
      report.action_modes,
      report.source,
      report.occurred_at,
      report.created_at,
      report.updated_at,
      report.confirmed_at,
      report.provenance_status,
      report.cleaning_projection_status,
      report.refill_projection_status,
      (SELECT count(*) FROM public.service_action_refill_lines line WHERE line.report_id = report.id) AS refill_line_count,
      (SELECT count(*) FROM public.service_action_attachments attachment WHERE attachment.report_id = report.id) AS attachment_count,
      (SELECT count(*) FROM public.service_action_questions question WHERE question.report_id = report.id AND question.status = 'open') AS open_question_count,
      (SELECT count(*) FROM public.service_action_report_incidents link WHERE link.report_id = report.id) AS incident_count,
      ai.status AS ai_status,
      (ai.id IS NOT NULL AND ai.reviewed_at IS NULL) AS ai_review_pending,
      array_remove(ARRAY[
        CASE WHEN report.status = 'draft' THEN 'draft' END,
        CASE WHEN report.provenance_status IN ('unresolved', 'partially_resolved') THEN 'provenance' END,
        CASE WHEN report.cleaning_projection_status = 'failed' THEN 'cleaning_projection_failed' END,
        CASE WHEN report.refill_projection_status IN ('partial', 'failed') THEN 'refill_projection_' || report.refill_projection_status END,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.service_action_questions question
          WHERE question.report_id = report.id AND question.status = 'open'
        ) THEN 'open_questions' END,
        CASE WHEN ai.id IS NOT NULL AND ai.reviewed_at IS NULL THEN 'ai_review_pending' END
      ], NULL) AS attention_reasons,
      report.updated_at AS sort_updated_at
    FROM public.service_action_reports report
    JOIN public.machines machine ON machine.id = report.machine_id
    LEFT JOIN public.profiles owner ON owner.id = report.operator_id
    LEFT JOIN public.service_action_ai_jobs ai ON ai.report_id = report.id
    WHERE (p_status = 'all' OR report.status = p_status)
      AND (p_machine_id IS NULL OR report.machine_id = p_machine_id)
      AND (
        v_role = 'admin'
        OR (
          report.operator_id = p_actor_id
          AND machine.deployed
          AND (
            (v_role = 'operator' AND EXISTS (
              SELECT 1
              FROM public.user_machine_assignments assignment
              WHERE assignment.user_id = p_actor_id
                AND assignment.machine_id = report.machine_id
                AND assignment.starts_at <= report.occurred_at
                AND (assignment.ends_at IS NULL OR assignment.ends_at >= report.occurred_at)
            ))
            OR (v_role = 'franchisee' AND v_tenant_id = (
              SELECT assignment.tenant_id
              FROM public.machine_franchisee_assignments assignment
              WHERE assignment.machine_id = report.machine_id
                AND assignment.start_date <= (report.occurred_at AT TIME ZONE 'Europe/Madrid')::DATE
                AND (assignment.end_date IS NULL OR assignment.end_date >= (report.occurred_at AT TIME ZONE 'Europe/Madrid')::DATE)
              ORDER BY assignment.start_date DESC
              LIMIT 1
            ))
          )
          AND (
            report.status <> 'draft'
            OR (v_role = 'operator' AND EXISTS (
              SELECT 1
              FROM public.user_machine_assignments assignment
              WHERE assignment.user_id = p_actor_id
                AND assignment.machine_id = report.machine_id
                AND assignment.starts_at <= now()
                AND (assignment.ends_at IS NULL OR assignment.ends_at >= now())
            ))
            OR (v_role = 'franchisee' AND v_tenant_id = (
              SELECT assignment.tenant_id
              FROM public.machine_franchisee_assignments assignment
              WHERE assignment.machine_id = report.machine_id
                AND assignment.start_date <= (now() AT TIME ZONE 'Europe/Madrid')::DATE
                AND (assignment.end_date IS NULL OR assignment.end_date >= (now() AT TIME ZONE 'Europe/Madrid')::DATE)
              ORDER BY assignment.start_date DESC
              LIMIT 1
            ))
          )
        )
      )
    ORDER BY report.updated_at DESC, report.id DESC
    LIMIT p_limit
    OFFSET p_offset
  ) report_row;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_read_action_reports(UUID, TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_read_action_reports(UUID, TEXT, UUID, INTEGER, INTEGER) TO service_role;
