CREATE TABLE IF NOT EXISTS public.mcp_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  key_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

ALTER TABLE public.mcp_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own keys" ON public.mcp_api_keys
  FOR ALL TO authenticated USING (true) WITH CHECK (true);;
