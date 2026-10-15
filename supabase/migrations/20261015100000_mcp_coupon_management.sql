ALTER TABLE public.mcp_api_keys DROP CONSTRAINT IF EXISTS mcp_api_keys_scopes_check;
ALTER TABLE public.mcp_api_keys ADD CONSTRAINT mcp_api_keys_scopes_check CHECK (
  cardinality(scopes) BETWEEN 1 AND 3
  AND scopes <@ ARRAY['read', 'forms', 'commands', 'sales_context', 'sales_notes', 'incidents', 'coupons']::TEXT[]
);

CREATE TABLE public.mcp_coupon_operations (
  client_uuid UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('create_group', 'distribute_code')),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_coupon_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_coupon_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mcp_coupon_operations TO service_role;
