ALTER TABLE public.service_action_ai_jobs
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'report' CHECK (purpose IN ('report', 'notes'));

CREATE OR REPLACE FUNCTION public.finalize_service_action_audio(
  p_report_id UUID, p_storage_path TEXT, p_mime_type TEXT, p_size_bytes BIGINT, p_actor_id UUID, p_purpose TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attachment_id UUID; v_job_id UUID; v_report_status TEXT; v_existing_purpose TEXT;
BEGIN
  SELECT status INTO v_report_status FROM public.service_action_reports WHERE id = p_report_id FOR UPDATE;
  IF v_report_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Audio can only be added to a draft'; END IF;
  IF p_purpose NOT IN ('report', 'notes') THEN RAISE EXCEPTION 'Invalid voice purpose'; END IF;
  IF p_size_bytes <= 0 OR p_size_bytes > 20971520 OR p_mime_type NOT IN ('audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav') THEN RAISE EXCEPTION 'Unsupported audio object'; END IF;
  SELECT attachment.id, job.id, job.purpose INTO v_attachment_id, v_job_id, v_existing_purpose
  FROM public.service_action_attachments attachment
  LEFT JOIN public.service_action_ai_jobs job ON job.attachment_id = attachment.id
  WHERE attachment.storage_path = p_storage_path AND attachment.report_id = p_report_id;
  IF v_job_id IS NOT NULL THEN
    IF v_existing_purpose IS DISTINCT FROM p_purpose THEN RAISE EXCEPTION 'Voice purpose conflicts with existing attachment'; END IF;
    RETURN jsonb_build_object('attachment_id', v_attachment_id, 'job_id', v_job_id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.service_action_ai_jobs WHERE report_id = p_report_id) THEN RAISE EXCEPTION 'This draft already has a voice AI job'; END IF;
  IF v_attachment_id IS NULL THEN
    INSERT INTO public.service_action_attachments(report_id, kind, storage_path, mime_type, size_bytes, created_by)
      VALUES (p_report_id, 'audio', p_storage_path, p_mime_type, p_size_bytes, p_actor_id) RETURNING id INTO v_attachment_id;
  END IF;
  INSERT INTO public.service_action_ai_jobs(report_id, attachment_id, purpose)
    VALUES (p_report_id, v_attachment_id, p_purpose) RETURNING id INTO v_job_id;
  RETURN jsonb_build_object('attachment_id', v_attachment_id, 'job_id', v_job_id);
END;
$$;

DROP FUNCTION public.claim_service_action_ai_jobs(TEXT, INTEGER);
CREATE FUNCTION public.claim_service_action_ai_jobs(p_worker TEXT, p_limit INTEGER DEFAULT 1)
RETURNS TABLE(job_id UUID, report_id UUID, attachment_id UUID, storage_path TEXT, mime_type TEXT, purpose TEXT, lease_token UUID, attempt_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(p_worker), '') IS NULL THEN RAISE EXCEPTION 'Worker is required'; END IF;
  RETURN QUERY WITH claimed AS (
    SELECT job.id FROM public.service_action_ai_jobs job
    JOIN public.service_action_reports report ON report.id = job.report_id AND report.status = 'draft'
    WHERE (job.status IN ('queued', 'retry_wait') AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= now()))
      OR (job.status = 'processing' AND (job.lease_expires_at IS NULL OR job.lease_expires_at < now()))
    ORDER BY job.updated_at, job.id LIMIT LEAST(GREATEST(p_limit, 1), 10) FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE public.service_action_ai_jobs job SET status = 'processing', attempt_count = job.attempt_count + 1,
      lease_owner = p_worker, lease_token = gen_random_uuid(), lease_expires_at = now() + INTERVAL '5 minutes', updated_at = now()
    FROM claimed WHERE job.id = claimed.id RETURNING job.id, job.report_id, job.attachment_id, job.purpose, job.lease_token, job.attempt_count
  )
  SELECT updated.id, updated.report_id, updated.attachment_id, attachment.storage_path, attachment.mime_type,
    updated.purpose, updated.lease_token, updated.attempt_count
  FROM updated JOIN public.service_action_attachments attachment ON attachment.id = updated.attachment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_service_action_audio(UUID, TEXT, TEXT, BIGINT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_service_action_ai_jobs(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_service_action_audio(UUID, TEXT, TEXT, BIGINT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_service_action_ai_jobs(TEXT, INTEGER) TO service_role;
