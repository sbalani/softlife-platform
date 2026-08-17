INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mobile-apks',
  'mobile-apks',
  false,
  209715200,
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.mobile_apk_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expo_url TEXT NOT NULL UNIQUE,
  version TEXT,
  build_number TEXT,
  release_notes TEXT,
  object_path TEXT NOT NULL UNIQUE,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mobile_apk_builds_published_idx ON public.mobile_apk_builds (published_at DESC, id DESC);

CREATE TABLE public.mobile_apk_user_state (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  build_id UUID NOT NULL REFERENCES public.mobile_apk_builds(id) ON DELETE CASCADE,
  downloaded_at TIMESTAMPTZ,
  suppressed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, build_id)
);

CREATE INDEX mobile_apk_user_state_build_idx ON public.mobile_apk_user_state (build_id);

ALTER TABLE public.mobile_apk_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_apk_user_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_apk_builds FROM anon, authenticated;
REVOKE ALL ON public.mobile_apk_user_state FROM anon, authenticated;

COMMENT ON TABLE public.mobile_apk_builds IS 'Private Android APK releases ingested from Expo artifacts; application retention keeps the newest five.';
COMMENT ON TABLE public.mobile_apk_user_state IS 'Per-user download and alert suppression state for mobile APK releases.';
