UPDATE public.mcp_api_keys
SET scopes = ARRAY(
  SELECT DISTINCT scope
  FROM unnest(array_remove(scopes, 'coupons') || ARRAY['read', 'commands']::TEXT[]) AS scope
)
WHERE scopes @> ARRAY['coupons']::TEXT[];

ALTER TABLE public.mcp_api_keys DROP CONSTRAINT IF EXISTS mcp_api_keys_scopes_check;
ALTER TABLE public.mcp_api_keys ADD CONSTRAINT mcp_api_keys_scopes_check CHECK (
  scopes <@ ARRAY['read', 'forms', 'commands', 'sales_context', 'sales_notes', 'incidents']::TEXT[]
  AND cardinality(scopes) > 0
);
