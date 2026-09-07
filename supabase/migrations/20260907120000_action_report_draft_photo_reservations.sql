ALTER TABLE public.service_action_photo_uploads ADD COLUMN report_revision INTEGER;

CREATE OR REPLACE FUNCTION public.reserve_service_action_photo_upload(
  p_report_id UUID,
  p_actor_id UUID,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_expected_size_bytes BIGINT,
  p_line_number INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  report_row public.service_action_reports%ROWTYPE;
  actor_role TEXT;
  upload_id UUID;
  used_slots INTEGER;
BEGIN
  SELECT * INTO report_row FROM public.service_action_reports WHERE id = p_report_id FOR UPDATE;
  SELECT role INTO actor_role FROM public.profiles WHERE id = p_actor_id;
  IF report_row.id IS NULL OR actor_role IS NULL OR report_row.status NOT IN ('draft', 'confirmed')
    OR (actor_role <> 'admin' AND report_row.operator_id <> p_actor_id) THEN
    RAISE EXCEPTION 'Action Report not found';
  END IF;
  IF p_storage_path = '' OR p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')
    OR p_expected_size_bytes NOT BETWEEN 1 AND 4194304 OR (p_line_number IS NOT NULL AND p_line_number NOT BETWEEN 1 AND 20) THEN
    RAISE EXCEPTION 'Invalid photo reservation';
  END IF;
  IF p_line_number IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_action_refill_lines WHERE report_id = p_report_id AND line_number = p_line_number
  ) THEN RAISE EXCEPTION 'Refill line not found'; END IF;

  SELECT
    (SELECT count(*) FROM public.service_action_attachments WHERE report_id = p_report_id AND kind = 'photo')
    + (SELECT count(*) FROM public.service_action_photo_uploads WHERE report_id = p_report_id AND completed_attachment_id IS NULL AND expires_at > now())
  INTO used_slots;
  IF used_slots >= 20 THEN RAISE EXCEPTION 'Photo limit reached'; END IF;

  INSERT INTO public.service_action_photo_uploads (
    report_id, actor_id, storage_path, mime_type, expected_size_bytes, line_number, report_revision
  ) VALUES (
    p_report_id, p_actor_id, p_storage_path, p_mime_type, p_expected_size_bytes, p_line_number, report_row.revision
  ) RETURNING id INTO upload_id;
  RETURN upload_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_service_action_photo_upload(
  p_upload_id UUID,
  p_actor_id UUID,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upload_row public.service_action_photo_uploads%ROWTYPE;
  report_row public.service_action_reports%ROWTYPE;
  actor_role TEXT;
  refill_line_id UUID;
  attachment_id UUID;
BEGIN
  SELECT * INTO upload_row FROM public.service_action_photo_uploads WHERE id = p_upload_id FOR UPDATE;
  SELECT role INTO actor_role FROM public.profiles WHERE id = p_actor_id;
  IF upload_row.id IS NULL OR actor_role IS NULL OR (actor_role <> 'admin' AND upload_row.actor_id <> p_actor_id) THEN
    RAISE EXCEPTION 'Photo reservation not found';
  END IF;
  IF upload_row.completed_attachment_id IS NOT NULL THEN RETURN upload_row.completed_attachment_id; END IF;
  SELECT * INTO report_row FROM public.service_action_reports WHERE id = upload_row.report_id FOR UPDATE;
  IF report_row.status NOT IN ('draft', 'confirmed') THEN RAISE EXCEPTION 'Action Report not attachable'; END IF;
  IF upload_row.report_revision IS NOT NULL AND report_row.revision IS DISTINCT FROM upload_row.report_revision THEN
    RAISE EXCEPTION 'Photo reservation report revision changed';
  END IF;
  IF upload_row.expires_at <= now() OR upload_row.storage_path <> p_storage_path OR upload_row.mime_type <> p_mime_type
    OR upload_row.expected_size_bytes <> p_size_bytes THEN RAISE EXCEPTION 'Photo reservation does not match upload'; END IF;
  IF upload_row.line_number IS NOT NULL THEN
    SELECT id INTO refill_line_id FROM public.service_action_refill_lines
    WHERE report_id = upload_row.report_id AND line_number = upload_row.line_number;
    IF refill_line_id IS NULL THEN RAISE EXCEPTION 'Refill line not found'; END IF;
  END IF;

  INSERT INTO public.service_action_attachments (
    report_id, refill_line_id, kind, storage_path, mime_type, size_bytes, created_by
  ) VALUES (
    upload_row.report_id, refill_line_id, 'photo', upload_row.storage_path,
    upload_row.mime_type, p_size_bytes, upload_row.actor_id
  ) ON CONFLICT (storage_path) DO UPDATE SET storage_path = EXCLUDED.storage_path
  RETURNING id INTO attachment_id;

  UPDATE public.service_action_photo_uploads SET completed_attachment_id = attachment_id, completed_at = now()
  WHERE id = upload_row.id;
  RETURN attachment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_service_action_photo_upload_retryable(
  p_upload_id UUID,
  p_actor_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upload_row public.service_action_photo_uploads%ROWTYPE;
  actor_role TEXT;
BEGIN
  SELECT * INTO upload_row FROM public.service_action_photo_uploads WHERE id = p_upload_id FOR UPDATE;
  SELECT role INTO actor_role FROM public.profiles WHERE id = p_actor_id;
  IF upload_row.id IS NULL OR actor_role IS NULL OR (actor_role <> 'admin' AND upload_row.actor_id <> p_actor_id) THEN
    RAISE EXCEPTION 'Photo reservation not found';
  END IF;
  IF upload_row.completed_attachment_id IS NOT NULL THEN RAISE EXCEPTION 'Photo upload is already complete'; END IF;
  UPDATE public.service_action_photo_uploads SET expires_at = now() WHERE id = upload_row.id;
  RETURN upload_row.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_service_action_photo_upload_retryable(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_service_action_photo_upload_retryable(UUID, UUID) TO service_role;
