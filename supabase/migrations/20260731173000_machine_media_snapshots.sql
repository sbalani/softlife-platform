CREATE TABLE public.machine_media_snapshots (
  machine_id UUID PRIMARY KEY REFERENCES public.machines(id) ON DELETE CASCADE,
  device_imei TEXT NOT NULL UNIQUE,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_media_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_media_snapshots FROM anon, authenticated;
