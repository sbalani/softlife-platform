ALTER TABLE public.service_action_attachments
  ADD COLUMN stage TEXT,
  ADD COLUMN caption TEXT;

UPDATE public.service_action_attachments
SET stage = CASE WHEN refill_line_id IS NULL THEN 'general' ELSE 'refill_batch' END
WHERE kind = 'photo' AND stage IS NULL;

ALTER TABLE public.service_action_attachments
  ADD CONSTRAINT service_action_attachments_stage_check CHECK (
    (kind = 'audio' AND stage IS NULL)
    OR (kind = 'photo' AND stage IN ('general', 'cleaning_before', 'cleaning_after', 'refill_batch'))
  ),
  ADD CONSTRAINT service_action_attachments_caption_check CHECK (
    caption IS NULL OR (caption = btrim(caption) AND length(caption) BETWEEN 1 AND 500)
  ),
  ADD CONSTRAINT service_action_attachments_refill_stage_check CHECK (
    kind <> 'photo'
    OR (stage = 'refill_batch' AND refill_line_id IS NOT NULL)
    OR (stage <> 'refill_batch' AND refill_line_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.finalize_unreserved_service_action_photo_v2(
  p_report_id UUID,
  p_actor_id UUID,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_refill_line_id UUID DEFAULT NULL,
  p_stage TEXT DEFAULT NULL,
  p_caption TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  report_row public.service_action_reports%ROWTYPE;
  actor_role TEXT;
  attachment_id UUID;
  used_slots INTEGER;
  normalized_stage TEXT := COALESCE(p_stage, CASE WHEN p_refill_line_id IS NULL THEN 'general' ELSE 'refill_batch' END);
  normalized_caption TEXT := NULLIF(btrim(p_caption), '');
BEGIN
  SELECT * INTO report_row FROM public.service_action_reports WHERE id = p_report_id FOR UPDATE;
  SELECT role INTO actor_role FROM public.profiles WHERE id = p_actor_id;
  IF report_row.id IS NULL OR actor_role IS NULL OR report_row.status = 'voided'
    OR (actor_role <> 'admin' AND report_row.operator_id <> p_actor_id) THEN
    RAISE EXCEPTION 'Action Report not found';
  END IF;
  SELECT id INTO attachment_id FROM public.service_action_attachments WHERE storage_path = p_storage_path;
  IF attachment_id IS NOT NULL THEN RETURN attachment_id; END IF;
  IF p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')
    OR p_size_bytes NOT BETWEEN 1 AND 20971520
    OR normalized_stage NOT IN ('general', 'cleaning_before', 'cleaning_after', 'refill_batch')
    OR (normalized_stage = 'refill_batch') <> (p_refill_line_id IS NOT NULL)
    OR (normalized_caption IS NOT NULL AND length(normalized_caption) > 500) THEN
    RAISE EXCEPTION 'Invalid photo';
  END IF;
  IF p_refill_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_action_refill_lines WHERE id = p_refill_line_id AND report_id = p_report_id
  ) THEN RAISE EXCEPTION 'Refill line not found'; END IF;
  SELECT count(*) INTO used_slots FROM public.service_action_attachments WHERE report_id = p_report_id AND kind = 'photo';
  IF used_slots >= 20 THEN RAISE EXCEPTION 'Photo limit reached'; END IF;
  INSERT INTO public.service_action_attachments (
    report_id, refill_line_id, kind, storage_path, mime_type, size_bytes, created_by, stage, caption
  ) VALUES (
    p_report_id, p_refill_line_id, 'photo', p_storage_path, p_mime_type, p_size_bytes, p_actor_id,
    normalized_stage, normalized_caption
  ) RETURNING id INTO attachment_id;
  RETURN attachment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_unreserved_service_action_photo_v2(UUID, UUID, TEXT, TEXT, BIGINT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_unreserved_service_action_photo_v2(UUID, UUID, TEXT, TEXT, BIGINT, UUID, TEXT, TEXT) TO service_role;

CREATE TABLE public.service_action_stock_snapshot_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL UNIQUE REFERENCES public.service_action_reports(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry_wait', 'complete', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  total_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (total_attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_action_stock_snapshot_jobs_queue_idx
  ON public.service_action_stock_snapshot_jobs(status, next_attempt_at, updated_at);
ALTER TABLE public.service_action_stock_snapshot_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_action_stock_snapshot_jobs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_service_action_stock_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'confirmed' AND 'refill' = ANY(NEW.action_modes) THEN
    INSERT INTO public.service_action_stock_snapshot_jobs(report_id, requested_by)
    VALUES (NEW.id, NEW.operator_id)
    ON CONFLICT (report_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enqueue_service_action_stock_snapshot
AFTER INSERT OR UPDATE OF status, action_modes ON public.service_action_reports
FOR EACH ROW EXECUTE FUNCTION public.enqueue_service_action_stock_snapshot();

INSERT INTO public.service_action_stock_snapshot_jobs(report_id, requested_by, status, completed_at)
SELECT report.id, report.operator_id,
  CASE WHEN snapshot.id IS NULL THEN 'queued' ELSE 'complete' END,
  CASE WHEN snapshot.id IS NULL THEN NULL ELSE snapshot.captured_at END
FROM public.service_action_reports report
LEFT JOIN public.service_action_stock_snapshots snapshot ON snapshot.report_id = report.id
WHERE report.status = 'confirmed' AND 'refill' = ANY(report.action_modes)
ON CONFLICT (report_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.complete_service_action_stock_snapshot_job_from_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.service_action_stock_snapshot_jobs
  SET status = 'complete', completed_at = NEW.captured_at, next_attempt_at = NULL,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = now()
  WHERE report_id = NEW.report_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER complete_service_action_stock_snapshot_job
AFTER INSERT ON public.service_action_stock_snapshots
FOR EACH ROW EXECUTE FUNCTION public.complete_service_action_stock_snapshot_job_from_snapshot();

CREATE OR REPLACE FUNCTION public.claim_service_action_stock_snapshot_jobs(p_worker TEXT, p_limit INTEGER DEFAULT 1)
RETURNS TABLE(job_id UUID, report_id UUID, actor_id UUID, lease_token UUID, attempt_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NULLIF(btrim(p_worker), '') IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid stock worker claim'; END IF;
  UPDATE public.service_action_stock_snapshot_jobs job
  SET status = 'complete', completed_at = snapshot.captured_at, next_attempt_at = NULL,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = now()
  FROM public.service_action_stock_snapshots snapshot
  WHERE snapshot.report_id = job.report_id AND job.status <> 'complete';
  RETURN QUERY
  WITH candidates AS (
    SELECT queued.id FROM public.service_action_stock_snapshot_jobs queued
    WHERE (queued.status IN ('queued', 'retry_wait') AND COALESCE(queued.next_attempt_at, '-infinity') <= now())
       OR (queued.status = 'processing' AND queued.lease_expires_at < now())
    ORDER BY queued.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.service_action_stock_snapshot_jobs claimed
  SET status = 'processing', attempt_count = claimed.attempt_count + 1,
      total_attempt_count = claimed.total_attempt_count + 1, last_attempt_at = now(),
      lease_owner = p_worker, lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', updated_at = now()
  FROM candidates WHERE claimed.id = candidates.id
  RETURNING claimed.id, claimed.report_id, claimed.requested_by, claimed.lease_token, claimed.attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_service_action_stock_snapshot_job(
  p_job_id UUID, p_worker TEXT, p_lease_token UUID, p_error TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_status TEXT;
BEGIN
  SELECT CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'retry_wait' END INTO next_status
  FROM public.service_action_stock_snapshot_jobs
  WHERE id = p_job_id AND status = 'processing' AND lease_owner = p_worker AND lease_token = p_lease_token AND lease_expires_at > now()
  FOR UPDATE;
  IF next_status IS NULL THEN RAISE EXCEPTION 'Stock snapshot job lease is invalid'; END IF;
  UPDATE public.service_action_stock_snapshot_jobs
  SET status = next_status,
      next_attempt_at = CASE WHEN next_status = 'failed' THEN NULL ELSE now() + CASE attempt_count
        WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' WHEN 3 THEN interval '15 minutes' ELSE interval '1 hour' END END,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      last_error = left(COALESCE(p_error, 'Unknown error'), 1000), updated_at = now()
  WHERE id = p_job_id;
  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_service_action_stock_snapshot_job(p_report_id UUID, p_actor_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE job_row public.service_action_stock_snapshot_jobs%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_action_reports report
    WHERE report.id = p_report_id AND report.status = 'confirmed' AND 'refill' = ANY(report.action_modes)
      AND (report.operator_id = p_actor_id OR EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id = p_actor_id AND profile.role = 'admin'))
  ) THEN RAISE EXCEPTION 'Confirmed refill report not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_action_stock_snapshots WHERE report_id = p_report_id) THEN
    SELECT * INTO job_row FROM public.service_action_stock_snapshot_jobs WHERE report_id = p_report_id;
    RETURN jsonb_build_object('status', 'complete', 'attempts', COALESCE(job_row.total_attempt_count, 0));
  END IF;
  INSERT INTO public.service_action_stock_snapshot_jobs(report_id, requested_by)
  VALUES (p_report_id, p_actor_id)
  ON CONFLICT (report_id) DO UPDATE SET status = 'queued', attempt_count = 0, next_attempt_at = NULL,
    lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = now()
  WHERE service_action_stock_snapshot_jobs.status = 'failed'
  RETURNING * INTO job_row;
  IF job_row.id IS NULL THEN SELECT * INTO job_row FROM public.service_action_stock_snapshot_jobs WHERE report_id = p_report_id; END IF;
  RETURN jsonb_build_object('status', job_row.status, 'attempts', job_row.total_attempt_count);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_service_action_stock_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_service_action_stock_snapshot_job_from_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_service_action_stock_snapshot_jobs(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_service_action_stock_snapshot_job(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_service_action_stock_snapshot_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_service_action_stock_snapshot_jobs(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_service_action_stock_snapshot_job(UUID, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_service_action_stock_snapshot_job(UUID, UUID) TO service_role;
