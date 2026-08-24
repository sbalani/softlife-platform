CREATE TABLE public.service_action_stock_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL UNIQUE REFERENCES public.service_action_reports(id) ON DELETE RESTRICT,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  device_imei TEXT NOT NULL,
  report_occurred_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('captured', 'needs_review')),
  source TEXT NOT NULL DEFAULT 'huaxin_product_api' CHECK (source = 'huaxin_product_api'),
  raw_payload JSONB NOT NULL,
  response_sha256 TEXT NOT NULL,
  captured_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.service_action_stock_snapshot_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES public.service_action_stock_snapshots(id) ON DELETE RESTRICT,
  menu_kind TEXT NOT NULL CHECK (menu_kind IN ('diy', 'unify')),
  position TEXT NOT NULL,
  goods_name_raw TEXT,
  stock_raw TEXT,
  stock_count BIGINT CHECK (stock_count IS NULL OR stock_count >= 0),
  enabled BOOLEAN,
  platform_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  mapping_method TEXT NOT NULL CHECK (mapping_method IN ('explicit_hopper_assignment', 'unresolved')),
  raw_item JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, menu_kind, position)
);

CREATE INDEX service_action_stock_snapshots_machine_time_idx
  ON public.service_action_stock_snapshots(machine_id, captured_at DESC);

ALTER TABLE public.service_action_stock_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_stock_snapshot_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_action_stock_snapshots, public.service_action_stock_snapshot_items FROM anon, authenticated;

CREATE TABLE public.service_action_photo_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.service_action_reports(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  expected_size_bytes BIGINT NOT NULL CHECK (expected_size_bytes BETWEEN 1 AND 4194304),
  line_number INTEGER CHECK (line_number BETWEEN 1 AND 20),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '2 hours',
  completed_attachment_id UUID REFERENCES public.service_action_attachments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX service_action_photo_uploads_report_active_idx
  ON public.service_action_photo_uploads(report_id, expires_at DESC)
  WHERE completed_attachment_id IS NULL;

ALTER TABLE public.service_action_photo_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_action_photo_uploads FROM anon, authenticated;

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
  IF report_row.id IS NULL OR actor_role IS NULL OR report_row.status <> 'confirmed' OR (actor_role <> 'admin' AND report_row.operator_id <> p_actor_id) THEN
    RAISE EXCEPTION 'Confirmed Action Report not found';
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
    report_id, actor_id, storage_path, mime_type, expected_size_bytes, line_number
  ) VALUES (
    p_report_id, p_actor_id, p_storage_path, p_mime_type, p_expected_size_bytes, p_line_number
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
  actor_role TEXT;
  refill_line_id UUID;
  attachment_id UUID;
BEGIN
  SELECT * INTO upload_row FROM public.service_action_photo_uploads WHERE id = p_upload_id FOR UPDATE;
  SELECT role INTO actor_role FROM public.profiles WHERE id = p_actor_id;
  IF upload_row.id IS NULL OR (actor_role <> 'admin' AND upload_row.actor_id <> p_actor_id) THEN RAISE EXCEPTION 'Photo reservation not found'; END IF;
  IF upload_row.completed_attachment_id IS NOT NULL THEN RETURN upload_row.completed_attachment_id; END IF;
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

CREATE OR REPLACE FUNCTION public.cancel_service_action_photo_upload(
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
  DELETE FROM public.service_action_photo_uploads WHERE id = upload_row.id;
  RETURN upload_row.storage_path;
END;
$$;

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
  actor_role TEXT;
  attachment_id UUID;
  used_slots INTEGER;
BEGIN
  SELECT * INTO report_row FROM public.service_action_reports WHERE id = p_report_id FOR UPDATE;
  SELECT role INTO actor_role FROM public.profiles WHERE id = p_actor_id;
  IF report_row.id IS NULL OR actor_role IS NULL OR report_row.status <> 'confirmed'
    OR (actor_role <> 'admin' AND report_row.operator_id <> p_actor_id) THEN RAISE EXCEPTION 'Confirmed Action Report not found'; END IF;
  SELECT id INTO attachment_id FROM public.service_action_attachments WHERE storage_path = p_storage_path;
  IF attachment_id IS NOT NULL THEN RETURN attachment_id; END IF;
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

REVOKE ALL ON FUNCTION public.reserve_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_service_action_photo_upload(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_unreserved_service_action_photo(UUID, UUID, TEXT, TEXT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_service_action_photo_upload(UUID, UUID, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_service_action_photo_upload(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_unreserved_service_action_photo(UUID, UUID, TEXT, TEXT, BIGINT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.record_service_action_stock_snapshot(
  p_report_id UUID,
  p_actor_id UUID,
  p_device_imei TEXT,
  p_captured_at TIMESTAMPTZ,
  p_raw_payload JSONB,
  p_response_sha256 TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  report_row public.service_action_reports%ROWTYPE;
  snapshot_row public.service_action_stock_snapshots%ROWTYPE;
  snapshot_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_report_id::TEXT, 0));
  SELECT * INTO report_row FROM public.service_action_reports WHERE id = p_report_id;
  IF NOT FOUND OR report_row.status <> 'confirmed' THEN RAISE EXCEPTION 'Confirmed Action Report not found'; END IF;
  IF NULLIF(btrim(p_device_imei), '') IS NULL OR p_captured_at IS NULL OR p_raw_payload IS NULL
    OR p_response_sha256 !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'Invalid stock snapshot'; END IF;

  SELECT * INTO snapshot_row FROM public.service_action_stock_snapshots WHERE report_id = p_report_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id', snapshot_row.id, 'status', snapshot_row.status, 'duplicate', true);
  END IF;

  snapshot_status := CASE WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    WHERE item->>'stock_count' IS NULL OR item->>'mapping_method' = 'unresolved'
  ) THEN 'needs_review' ELSE 'captured' END;

  INSERT INTO public.service_action_stock_snapshots (
    report_id, machine_id, device_imei, report_occurred_at, captured_at, status,
    raw_payload, response_sha256, captured_by
  ) VALUES (
    p_report_id, report_row.machine_id, btrim(p_device_imei), report_row.occurred_at,
    p_captured_at, snapshot_status, p_raw_payload, p_response_sha256, p_actor_id
  ) RETURNING * INTO snapshot_row;

  PERFORM set_config('app.recording_stock_snapshot', '1', true);
  INSERT INTO public.service_action_stock_snapshot_items (
    snapshot_id, menu_kind, position, goods_name_raw, stock_raw, stock_count,
    enabled, platform_product_id, mapping_method, raw_item
  )
  SELECT
    snapshot_row.id,
    item->>'menu_kind',
    item->>'position',
    NULLIF(item->>'goods_name_raw', ''),
    item->>'stock_raw',
    CASE WHEN item->>'stock_count' ~ '^\d+$' THEN (item->>'stock_count')::BIGINT ELSE NULL END,
    CASE WHEN item ? 'enabled' THEN (item->>'enabled')::BOOLEAN ELSE NULL END,
    CASE WHEN item->>'platform_product_id' ~ '^[0-9a-f-]{36}$' THEN (item->>'platform_product_id')::UUID ELSE NULL END,
    item->>'mapping_method',
    item->'raw_item'
  FROM jsonb_array_elements(p_items) item;

  RETURN jsonb_build_object('id', snapshot_row.id, 'status', snapshot_row.status, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.record_service_action_stock_snapshot(UUID, UUID, TEXT, TIMESTAMPTZ, JSONB, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_service_action_stock_snapshot(UUID, UUID, TEXT, TIMESTAMPTZ, JSONB, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_stock_snapshot_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND current_setting('app.recording_stock_snapshot', true) = '1' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Action Report stock snapshots are immutable';
END;
$$;

CREATE TRIGGER prevent_stock_snapshot_update_delete
BEFORE UPDATE OR DELETE ON public.service_action_stock_snapshots
FOR EACH ROW EXECUTE FUNCTION public.prevent_stock_snapshot_mutation();

CREATE TRIGGER prevent_stock_snapshot_item_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.service_action_stock_snapshot_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_stock_snapshot_mutation();

REVOKE ALL ON FUNCTION public.prevent_stock_snapshot_mutation() FROM PUBLIC, anon, authenticated;
