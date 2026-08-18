CREATE TABLE public.service_action_ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL UNIQUE REFERENCES public.service_action_reports(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL UNIQUE REFERENCES public.service_action_attachments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry_wait', 'complete', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  transcript_text TEXT,
  transcript_segments JSONB,
  transcript_language TEXT,
  duration_seconds NUMERIC,
  extraction JSONB,
  schema_version INTEGER NOT NULL DEFAULT 1,
  transcription_model TEXT,
  extraction_model TEXT,
  last_error TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX service_action_ai_jobs_queue_idx ON public.service_action_ai_jobs(status, next_attempt_at, updated_at);
ALTER TABLE public.service_action_ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_attachments ADD CONSTRAINT service_action_attachments_report_id_id_key UNIQUE(report_id, id);
ALTER TABLE public.service_action_ai_jobs ADD CONSTRAINT service_action_ai_jobs_report_attachment_fk
  FOREIGN KEY (report_id, attachment_id) REFERENCES public.service_action_attachments(report_id, id) ON DELETE CASCADE;

ALTER TABLE public.service_action_questions
  ADD COLUMN question_key TEXT,
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN ai_job_id UUID REFERENCES public.service_action_ai_jobs(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX service_action_questions_ai_key_idx
  ON public.service_action_questions(report_id, question_key) WHERE question_key IS NOT NULL;

CREATE TABLE public.service_action_attachment_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES public.service_action_attachments(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.service_action_attachment_access_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.guard_action_report_ai_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'confirmed' AND EXISTS (
    SELECT 1 FROM public.service_action_ai_jobs job
    WHERE job.report_id = NEW.id AND job.reviewed_at IS NULL
      AND job.status IN ('queued', 'processing', 'retry_wait', 'complete')
  ) THEN RAISE EXCEPTION 'Review or discard voice AI work before confirming this report'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER service_action_reports_guard_ai_confirmation
BEFORE UPDATE OF status ON public.service_action_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_action_report_ai_confirmation();

CREATE OR REPLACE FUNCTION public.finalize_service_action_audio(
  p_report_id UUID, p_storage_path TEXT, p_mime_type TEXT, p_size_bytes BIGINT, p_actor_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attachment_id UUID; v_job_id UUID; v_report_status TEXT;
BEGIN
  SELECT status INTO v_report_status FROM public.service_action_reports WHERE id = p_report_id FOR UPDATE;
  IF v_report_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Audio can only be added to a draft'; END IF;
  IF p_size_bytes <= 0 OR p_size_bytes > 20971520 OR p_mime_type NOT IN ('audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav') THEN RAISE EXCEPTION 'Unsupported audio object'; END IF;
  SELECT attachment.id, job.id INTO v_attachment_id, v_job_id
  FROM public.service_action_attachments attachment
  LEFT JOIN public.service_action_ai_jobs job ON job.attachment_id = attachment.id
  WHERE attachment.storage_path = p_storage_path AND attachment.report_id = p_report_id;
  IF v_job_id IS NOT NULL THEN RETURN jsonb_build_object('attachment_id', v_attachment_id, 'job_id', v_job_id); END IF;
  IF EXISTS (SELECT 1 FROM public.service_action_ai_jobs WHERE report_id = p_report_id) THEN RAISE EXCEPTION 'This draft already has a voice AI job'; END IF;
  IF v_attachment_id IS NULL THEN
    INSERT INTO public.service_action_attachments(report_id, kind, storage_path, mime_type, size_bytes, created_by)
      VALUES (p_report_id, 'audio', p_storage_path, p_mime_type, p_size_bytes, p_actor_id) RETURNING id INTO v_attachment_id;
  END IF;
  INSERT INTO public.service_action_ai_jobs(report_id, attachment_id) VALUES (p_report_id, v_attachment_id) RETURNING id INTO v_job_id;
  RETURN jsonb_build_object('attachment_id', v_attachment_id, 'job_id', v_job_id);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_service_action_ai_jobs(p_worker TEXT, p_limit INTEGER DEFAULT 1)
RETURNS TABLE(job_id UUID, report_id UUID, attachment_id UUID, storage_path TEXT, mime_type TEXT, lease_token UUID, attempt_count INTEGER)
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
    FROM claimed WHERE job.id = claimed.id RETURNING job.id, job.report_id, job.attachment_id, job.lease_token, job.attempt_count
  )
  SELECT updated.id, updated.report_id, updated.attachment_id, attachment.storage_path, attachment.mime_type, updated.lease_token, updated.attempt_count
  FROM updated JOIN public.service_action_attachments attachment ON attachment.id = updated.attachment_id;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_service_action_ai_job(
  p_job_id UUID, p_worker TEXT, p_lease_token UUID, p_transcript TEXT, p_segments JSONB,
  p_language TEXT, p_duration NUMERIC, p_extraction JSONB, p_questions JSONB,
  p_transcription_model TEXT, p_extraction_model TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_report_id UUID; v_question JSONB;
BEGIN
  UPDATE public.service_action_ai_jobs job SET status = 'complete', transcript_text = p_transcript,
    transcript_segments = p_segments, transcript_language = p_language, duration_seconds = p_duration,
    extraction = p_extraction, transcription_model = p_transcription_model, extraction_model = p_extraction_model,
    lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = now()
  WHERE job.id = p_job_id AND job.status = 'processing' AND job.lease_owner = p_worker AND job.lease_token = p_lease_token AND job.lease_expires_at >= now()
    AND EXISTS (SELECT 1 FROM public.service_action_reports report WHERE report.id = job.report_id AND report.status = 'draft')
  RETURNING job.report_id INTO v_report_id;
  IF v_report_id IS NULL THEN RAISE EXCEPTION 'AI job lease not found'; END IF;
  DELETE FROM public.service_action_questions WHERE ai_job_id = p_job_id;
  FOR v_question IN SELECT value FROM jsonb_array_elements(COALESCE(p_questions, '[]'::JSONB)) LOOP
    INSERT INTO public.service_action_questions(report_id, question, question_key, source, ai_job_id)
      VALUES (v_report_id, v_question->>'question', v_question->>'key', 'deterministic_ai_review', p_job_id)
      ON CONFLICT (report_id, question_key) WHERE question_key IS NOT NULL DO UPDATE
        SET question = EXCLUDED.question, ai_job_id = EXCLUDED.ai_job_id, status = 'open', answer = NULL, answered_at = NULL;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_service_action_ai_job(
  p_job_id UUID, p_worker TEXT, p_lease_token UUID, p_error TEXT, p_retry_at TIMESTAMPTZ
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.service_action_ai_jobs SET status = CASE WHEN p_retry_at IS NULL THEN 'failed' ELSE 'retry_wait' END,
    next_attempt_at = p_retry_at, last_error = left(p_error, 5000), lease_owner = NULL, lease_token = NULL,
    lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND status = 'processing' AND lease_owner = p_worker AND lease_token = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI job lease not found'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.finalize_service_action_audio(UUID, TEXT, TEXT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_service_action_ai_jobs(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_service_action_ai_job(UUID, TEXT, UUID, TEXT, JSONB, TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_service_action_ai_job(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_action_report_ai_confirmation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_service_action_audio(UUID, TEXT, TEXT, BIGINT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_service_action_ai_jobs(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_service_action_ai_job(UUID, TEXT, UUID, TEXT, JSONB, TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_service_action_ai_job(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;
