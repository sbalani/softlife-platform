CREATE TABLE public.direct_machine_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT NOT NULL CHECK (method IN ('POST')),
  content_type TEXT,
  body_size_bytes INTEGER NOT NULL CHECK (body_size_bytes BETWEEN 0 AND 262144),
  body_sha256 TEXT NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  body_json JSONB,
  body_text TEXT NOT NULL,
  device_hint TEXT CHECK (device_hint IS NULL OR char_length(device_hint) <= 200),
  query_params JSONB NOT NULL DEFAULT '{}'::JSONB,
  request_headers JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX direct_machine_payloads_received_at_idx
  ON public.direct_machine_payloads (received_at DESC);
CREATE INDEX direct_machine_payloads_device_time_idx
  ON public.direct_machine_payloads (device_hint, received_at DESC)
  WHERE device_hint IS NOT NULL;
CREATE INDEX direct_machine_payloads_hash_idx
  ON public.direct_machine_payloads (body_sha256, received_at DESC);

ALTER TABLE public.direct_machine_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.direct_machine_payloads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.direct_machine_payloads TO service_role;

COMMENT ON TABLE public.direct_machine_payloads IS
  'Isolated lab capture for direct machine payload discovery. Not connected to production processing.';
