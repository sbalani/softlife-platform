INSERT INTO public.incident_type_policies (incident_type, label, auto_create_from_alert, auto_assign_to_franchisee)
VALUES ('customer_report', 'Customer report', false, false)
ON CONFLICT (incident_type) DO UPDATE SET label = EXCLUDED.label, auto_create_from_alert = false, auto_assign_to_franchisee = false;

ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_source_kind_check;
ALTER TABLE public.incidents ADD CONSTRAINT incidents_source_kind_check CHECK (source_kind IN ('alert', 'schedule', 'manual', 'public'));

CREATE TABLE public.public_incident_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at TIMESTAMPTZ NOT NULL,
  ip_hash TEXT NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  reporter_name TEXT NOT NULL CHECK (length(btrim(reporter_name)) BETWEEN 1 AND 120),
  phone TEXT CHECK (phone IS NULL OR length(btrim(phone)) BETWEEN 5 AND 40),
  email TEXT CHECK (email IS NULL OR length(email) <= 254),
  contact_consent BOOLEAN NOT NULL CHECK (contact_consent),
  explanation TEXT CHECK (explanation IS NULL OR length(explanation) <= 4000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  incident_id UUID UNIQUE REFERENCES public.incidents(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CHECK ((status = 'draft' AND incident_id IS NULL AND submitted_at IS NULL) OR (status = 'submitted' AND incident_id IS NOT NULL AND submitted_at IS NOT NULL))
);

CREATE TABLE public.public_incident_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.public_incident_submissions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'image', 'video')),
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (
    (kind = 'audio' AND mime_type IN ('audio/webm', 'audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a') AND size_bytes <= 20971520)
    OR (kind = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') AND size_bytes <= 4194304)
    OR (kind = 'video' AND mime_type IN ('video/mp4', 'video/webm', 'video/quicktime') AND size_bytes <= 52428800)
  )
);

CREATE UNIQUE INDEX public_incident_one_audio ON public.public_incident_attachments (submission_id) WHERE kind = 'audio';
CREATE INDEX public_incident_submission_ip_time ON public.public_incident_submissions (ip_hash, created_at DESC);
CREATE INDEX public_incident_attachments_submission ON public.public_incident_attachments (submission_id, created_at);

ALTER TABLE public.public_incident_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_incident_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_incident_submissions, public.public_incident_attachments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.public_incident_submissions, public.public_incident_attachments TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('public-incident-evidence', 'public-incident-evidence', false, 52428800, ARRAY[
  'audio/webm', 'audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.create_public_incident_draft(
  p_token_hash TEXT, p_ip_hash TEXT, p_machine_id UUID, p_reporter_name TEXT,
  p_phone TEXT, p_email TEXT, p_explanation TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));
  IF NOT EXISTS (SELECT 1 FROM public.machines WHERE id = p_machine_id AND deployed) THEN RAISE EXCEPTION 'Machine not available'; END IF;
  IF (SELECT count(*) FROM public.public_incident_submissions WHERE ip_hash = p_ip_hash AND created_at > now() - INTERVAL '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Too many reports. Please try again later';
  END IF;
  INSERT INTO public.public_incident_submissions
    (token_hash, token_expires_at, ip_hash, machine_id, reporter_name, phone, email, contact_consent, explanation)
  VALUES (p_token_hash, now() + INTERVAL '2 hours', p_ip_hash, p_machine_id, btrim(p_reporter_name),
    NULLIF(btrim(p_phone), ''), NULLIF(lower(btrim(p_email)), ''), true, NULLIF(btrim(p_explanation), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_public_incident_attachment(
  p_submission_id UUID, p_token_hash TEXT, p_kind TEXT, p_storage_path TEXT,
  p_mime_type TEXT, p_size_bytes BIGINT, p_original_name TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_submission public.public_incident_submissions%ROWTYPE; v_id UUID; v_total BIGINT;
BEGIN
  SELECT * INTO v_submission FROM public.public_incident_submissions
  WHERE id = p_submission_id AND token_hash = p_token_hash AND token_expires_at > now() FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'draft' THEN RAISE EXCEPTION 'Draft not available'; END IF;
  IF p_storage_path NOT LIKE (p_submission_id::TEXT || '/%') OR p_kind NOT IN ('audio', 'image', 'video') THEN RAISE EXCEPTION 'Invalid attachment'; END IF;
  SELECT COALESCE(sum(size_bytes), 0) INTO v_total FROM public.public_incident_attachments WHERE submission_id = p_submission_id;
  IF v_total + p_size_bytes > 78643200 THEN RAISE EXCEPTION 'Attachment total exceeds 75 MB'; END IF;
  IF p_kind IN ('image', 'video') AND (SELECT count(*) FROM public.public_incident_attachments WHERE submission_id = p_submission_id AND kind IN ('image', 'video')) >= 5 THEN
    RAISE EXCEPTION 'A report can include at most five pictures or videos';
  END IF;
  INSERT INTO public.public_incident_attachments (submission_id, kind, storage_path, mime_type, size_bytes, original_name)
  VALUES (p_submission_id, p_kind, p_storage_path, p_mime_type, p_size_bytes, left(p_original_name, 200)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_public_incident_attachment(
  p_submission_id UUID, p_token_hash TEXT, p_attachment_id UUID, p_storage_path TEXT,
  p_mime_type TEXT, p_size_bytes BIGINT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_submission public.public_incident_submissions%ROWTYPE; v_attachment public.public_incident_attachments%ROWTYPE;
BEGIN
  SELECT * INTO v_submission FROM public.public_incident_submissions
  WHERE id = p_submission_id AND token_hash = p_token_hash AND token_expires_at > now() FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'draft' THEN RAISE EXCEPTION 'Draft not available'; END IF;
  SELECT * INTO v_attachment FROM public.public_incident_attachments
  WHERE id = p_attachment_id AND submission_id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_attachment.completed_at IS NOT NULL OR v_attachment.storage_path <> p_storage_path
    OR v_attachment.mime_type <> p_mime_type OR v_attachment.size_bytes <> p_size_bytes THEN
    RAISE EXCEPTION 'Attachment reservation does not match the uploaded object';
  END IF;
  UPDATE public.public_incident_attachments SET completed_at = now() WHERE id = p_attachment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_incident(p_submission_id UUID, p_token_hash TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_submission public.public_incident_submissions%ROWTYPE; v_incident_id UUID; v_machine_label TEXT;
BEGIN
  SELECT * INTO v_submission FROM public.public_incident_submissions
  WHERE id = p_submission_id AND token_hash = p_token_hash AND token_expires_at > now() FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'draft' THEN RAISE EXCEPTION 'Draft not available'; END IF;
  IF v_submission.explanation IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.public_incident_attachments WHERE submission_id = p_submission_id AND kind = 'audio' AND completed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Explain the issue or attach one voice recording'; END IF;
  IF EXISTS (SELECT 1 FROM public.public_incident_attachments WHERE submission_id = p_submission_id AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Every attachment must finish uploading before submission';
  END IF;
  SELECT COALESCE(display_name, name, 'Machine') INTO v_machine_label FROM public.machines WHERE id = v_submission.machine_id AND deployed;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not available'; END IF;
  INSERT INTO public.incidents (scope_kind, machine_id, incident_type, source_kind, title, description, severity, owning_tenant_id)
  VALUES ('machine', v_submission.machine_id, 'customer_report', 'public', 'Customer report - ' || v_machine_label,
    v_submission.explanation, 'warning', NULL) RETURNING id INTO v_incident_id;
  UPDATE public.public_incident_submissions SET status = 'submitted', incident_id = v_incident_id, submitted_at = now() WHERE id = p_submission_id;
  RETURN v_incident_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_incident_machine_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source_kind <> 'public' AND NEW.scope_kind = 'machine' AND NEW.machine_id IS NOT NULL AND NEW.owning_tenant_id IS NULL THEN
    NEW.owning_tenant_id := public.current_machine_franchisee(NEW.machine_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.incident_actor_can_access(p_incident_id UUID, p_actor_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.incidents incident JOIN public.profiles profile ON profile.id = p_actor_id
    WHERE incident.id = p_incident_id AND (
      (incident.source_kind = 'public' AND profile.role IN ('admin', 'operator'))
      OR (incident.source_kind <> 'public' AND (
        profile.role = 'admin' OR incident.assigned_user_id = p_actor_id OR incident.created_by = p_actor_id
        OR (profile.tenant_id IS NOT NULL AND profile.tenant_id IN (incident.owning_tenant_id, incident.assigned_tenant_id))
      ))
    )
  )
$$;

REVOKE ALL ON FUNCTION public.create_public_incident_draft(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_public_incident_attachment(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_public_incident_attachment(UUID, TEXT, UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_public_incident(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_incident_draft(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_public_incident_attachment(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_public_incident_attachment(UUID, TEXT, UUID, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_public_incident(UUID, TEXT) TO service_role;
