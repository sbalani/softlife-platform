ALTER TABLE public.mcp_api_keys DROP CONSTRAINT IF EXISTS mcp_api_keys_scopes_check;
ALTER TABLE public.mcp_api_keys ADD CONSTRAINT mcp_api_keys_scopes_check CHECK (
  cardinality(scopes) BETWEEN 1 AND 3
  AND scopes <@ ARRAY['read', 'forms', 'commands', 'sales_context', 'sales_notes', 'incidents']::TEXT[]
);

CREATE OR REPLACE FUNCTION public.mcp_read_incidents(
  p_actor_id UUID,
  p_incident_id UUID,
  p_status TEXT,
  p_source TEXT,
  p_machine_id UUID,
  p_include_recovered BOOLEAN,
  p_offset INTEGER,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id)
    OR p_status NOT IN ('active', 'resolved', 'all')
    OR p_source NOT IN ('system', 'user', 'all')
    OR p_include_recovered IS NULL
    OR p_offset NOT BETWEEN 0 AND 10000
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid incident query';
  END IF;

  SELECT COALESCE(jsonb_agg((to_jsonb(incident_row) - 'sort_at') ORDER BY incident_row.sort_at DESC, incident_row.id), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT incident.id, incident.status, incident.source_kind, incident.incident_type,
      policy.label AS type_label, incident.title, incident.description, incident.severity,
      incident.scope_kind, incident.machine_id,
      COALESCE(machine.display_name, machine.name) AS machine_name,
      machine.device_imei AS machine_imei, incident.odoo_warehouse_id,
      warehouse.name AS warehouse_name, incident.location_text,
      assigned_user.full_name AS assigned_user_name,
      assigned_tenant.name AS assigned_tenant_name,
      incident.due_at, incident.opened_at, incident.resolved_at,
      incident.source_alert_resolved_at, incident.resolution_summary,
      CASE WHEN incident.status IN ('resolved', 'closed') THEN incident.resolved_at ELSE incident.opened_at END AS sort_at
    FROM public.incidents incident
    LEFT JOIN public.incident_type_policies policy ON policy.incident_type = incident.incident_type
    LEFT JOIN public.machines machine ON machine.id = incident.machine_id
    LEFT JOIN public.odoo_warehouses warehouse ON warehouse.odoo_id = incident.odoo_warehouse_id
    LEFT JOIN public.profiles assigned_user ON assigned_user.id = incident.assigned_user_id
    LEFT JOIN public.tenants assigned_tenant ON assigned_tenant.id = incident.assigned_tenant_id
    WHERE public.incident_actor_can_access(incident.id, p_actor_id)
      AND (p_incident_id IS NULL OR incident.id = p_incident_id)
      AND (p_machine_id IS NULL OR incident.machine_id = p_machine_id)
      AND (p_include_recovered OR incident.source_alert_resolved_at IS NULL OR incident.status IN ('resolved', 'closed'))
      AND (p_status = 'all'
        OR (p_status = 'active' AND incident.status IN ('open', 'in_progress'))
        OR (p_status = 'resolved' AND incident.status IN ('resolved', 'closed')))
      AND (p_source = 'all'
        OR (p_source = 'system' AND incident.source_kind IN ('alert', 'schedule'))
        OR (p_source = 'user' AND incident.source_kind IN ('manual', 'public')))
    ORDER BY CASE WHEN incident.status IN ('resolved', 'closed') THEN incident.resolved_at ELSE incident.opened_at END DESC, incident.id
    LIMIT p_limit
    OFFSET p_offset
  ) incident_row;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_read_incidents(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_read_incidents(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER) TO service_role;
