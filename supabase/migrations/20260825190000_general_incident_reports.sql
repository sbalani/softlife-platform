INSERT INTO public.incident_type_policies (incident_type, label, auto_create_from_alert) VALUES
  ('warehouse_stock', 'Warehouse stock issue', false),
  ('maintenance', 'Maintenance', false),
  ('customer_request', 'Customer request', false),
  ('other', 'Other', false)
ON CONFLICT (incident_type) DO NOTHING;

ALTER TABLE public.incidents
  ALTER COLUMN machine_id DROP NOT NULL,
  ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'machine',
  ADD COLUMN odoo_warehouse_id INTEGER REFERENCES public.odoo_warehouses(odoo_id) ON DELETE RESTRICT,
  ADD COLUMN location_text TEXT,
  ADD COLUMN owning_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN assigned_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN resolution_summary TEXT,
  ADD COLUMN resolved_at TIMESTAMPTZ,
  ADD COLUMN resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.incidents incident SET
  scope_kind = 'machine',
  owning_tenant_id = public.current_machine_franchisee(incident.machine_id),
  resolution_summary = CASE WHEN incident.status = 'closed' THEN
    CASE WHEN incident.closure_kind = 'action_report' THEN 'Resolved through an Action Report.' ELSE 'Closed before resolution notes were required.' END
    ELSE NULL END,
  resolved_at = CASE WHEN incident.status = 'closed' THEN incident.closed_at ELSE NULL END,
  resolved_by = CASE WHEN incident.status = 'closed' THEN incident.closed_by ELSE NULL END;

ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_status_check;
ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_closure_kind_check;
ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_check;
UPDATE public.incidents SET status = 'resolved' WHERE status = 'closed';
ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_scope_kind_check CHECK (scope_kind IN ('machine', 'warehouse', 'location')),
  ADD CONSTRAINT incidents_scope_check CHECK (
    (scope_kind = 'machine' AND machine_id IS NOT NULL AND odoo_warehouse_id IS NULL)
    OR (scope_kind = 'warehouse' AND machine_id IS NULL AND odoo_warehouse_id IS NOT NULL)
    OR (scope_kind = 'location' AND machine_id IS NULL AND odoo_warehouse_id IS NULL AND NULLIF(btrim(location_text), '') IS NOT NULL)
  ),
  ADD CONSTRAINT incidents_status_check CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  ADD CONSTRAINT incidents_closure_kind_check CHECK (closure_kind IS NULL OR closure_kind IN ('action_report', 'incident_report', 'no_report')),
  ADD CONSTRAINT incidents_resolution_check CHECK (
    (status IN ('open', 'in_progress') AND closed_at IS NULL AND resolved_at IS NULL AND closure_kind IS NULL AND resolution_summary IS NULL)
    OR (status IN ('resolved', 'closed') AND closed_at IS NOT NULL AND resolved_at IS NOT NULL AND closure_kind IS NOT NULL AND NULLIF(btrim(resolution_summary), '') IS NOT NULL)
  );

DROP INDEX IF EXISTS public.service_action_report_incidents_one_closure;
DROP INDEX IF EXISTS public.incidents_one_open_scheduled_type;
CREATE UNIQUE INDEX incidents_one_open_scheduled_type
  ON public.incidents (machine_id, incident_type)
  WHERE status IN ('open', 'in_progress') AND source_kind = 'schedule';
CREATE INDEX incidents_scope_status_idx ON public.incidents (scope_kind, status, opened_at DESC);
CREATE INDEX incidents_warehouse_status_idx ON public.incidents (odoo_warehouse_id, status, opened_at DESC) WHERE odoo_warehouse_id IS NOT NULL;
CREATE INDEX incidents_assigned_user_idx ON public.incidents (assigned_user_id, status, opened_at DESC) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX incidents_owner_idx ON public.incidents (owning_tenant_id, status, opened_at DESC) WHERE owning_tenant_id IS NOT NULL;

CREATE TABLE public.incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'alert_updated', 'assigned', 'started', 'resolved', 'reopened', 'action_report_linked')),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX incident_events_incident_time_idx ON public.incident_events (incident_id, created_at, id);
ALTER TABLE public.incident_events ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.incident_events FROM anon, authenticated;
GRANT SELECT ON public.incident_events TO authenticated;

INSERT INTO public.incident_events (incident_id, event_type, actor_id, to_status, message, created_at)
SELECT id, 'created', created_by, 'open', 'Incident record created.', opened_at FROM public.incidents;
INSERT INTO public.incident_events (incident_id, event_type, actor_id, from_status, to_status, message, created_at)
SELECT id, 'resolved', resolved_by, 'open', status, resolution_summary, resolved_at
FROM public.incidents WHERE status IN ('resolved', 'closed');

CREATE OR REPLACE FUNCTION public.record_incident_created_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.incident_events (incident_id, event_type, actor_id, to_status, message, created_at)
  VALUES (NEW.id, 'created', NEW.created_by, 'open',
    CASE NEW.source_kind WHEN 'alert' THEN 'Created automatically from an alert.' WHEN 'schedule' THEN 'Created as scheduled work.' ELSE 'Manual incident created.' END,
    NEW.opened_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER incidents_record_created_event AFTER INSERT ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.record_incident_created_event();

CREATE OR REPLACE FUNCTION public.incident_actor_can_access(p_incident_id UUID, p_actor_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.incidents incident
    JOIN public.profiles profile ON profile.id = p_actor_id
    WHERE incident.id = p_incident_id AND (
      profile.role = 'admin'
      OR incident.assigned_user_id = p_actor_id
      OR incident.created_by = p_actor_id
      OR (profile.tenant_id IS NOT NULL AND profile.tenant_id IN (incident.owning_tenant_id, incident.assigned_tenant_id))
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_actor_can_access_incident(p_incident_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.incident_actor_can_access(p_incident_id, auth.uid())
$$;

DROP POLICY IF EXISTS incidents_read ON public.incidents;
CREATE POLICY incidents_read ON public.incidents FOR SELECT TO authenticated USING (public.current_actor_can_access_incident(id));
CREATE POLICY incident_events_read ON public.incident_events FOR SELECT TO authenticated USING (public.current_actor_can_access_incident(incident_id));

CREATE OR REPLACE FUNCTION public.set_incident_machine_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.scope_kind = 'machine' AND NEW.machine_id IS NOT NULL AND NEW.owning_tenant_id IS NULL THEN
    NEW.owning_tenant_id := public.current_machine_franchisee(NEW.machine_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER incidents_set_machine_owner BEFORE INSERT OR UPDATE OF machine_id, scope_kind ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.set_incident_machine_owner();

CREATE OR REPLACE FUNCTION public.create_incident(
  p_actor_id UUID, p_scope_kind TEXT, p_machine_id UUID, p_odoo_warehouse_id INTEGER, p_location_text TEXT,
  p_incident_type TEXT, p_title TEXT, p_description TEXT, p_severity TEXT, p_due_at TIMESTAMPTZ,
  p_owning_tenant_id UUID, p_assigned_tenant_id UUID, p_assigned_user_id UUID
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE; v_owner UUID; v_assigned_tenant UUID; v_id UUID;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_profile.role NOT IN ('admin', 'franchisee') THEN RAISE EXCEPTION 'Incident creation denied'; END IF;
  IF p_scope_kind NOT IN ('machine', 'warehouse', 'location') THEN RAISE EXCEPTION 'Invalid incident scope'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.incident_type_policies WHERE incident_type = p_incident_type) THEN RAISE EXCEPTION 'Invalid incident type'; END IF;
  IF p_severity NOT IN ('info', 'warning', 'critical') THEN RAISE EXCEPTION 'Invalid severity'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL OR char_length(btrim(p_title)) > 200 THEN RAISE EXCEPTION 'Enter an incident title'; END IF;

  IF p_scope_kind = 'machine' THEN
    IF p_machine_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.machines WHERE id = p_machine_id) THEN RAISE EXCEPTION 'Machine not found'; END IF;
    v_owner := public.current_machine_franchisee(p_machine_id);
    IF v_profile.role = 'franchisee' AND (v_profile.tenant_id IS NULL OR v_owner IS DISTINCT FROM v_profile.tenant_id) THEN RAISE EXCEPTION 'Machine access denied'; END IF;
  ELSIF p_scope_kind = 'warehouse' THEN
    IF p_odoo_warehouse_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.odoo_warehouses WHERE odoo_id = p_odoo_warehouse_id) THEN RAISE EXCEPTION 'Warehouse not found'; END IF;
    v_owner := CASE WHEN v_profile.role = 'franchisee' THEN v_profile.tenant_id ELSE p_owning_tenant_id END;
    IF v_profile.role = 'franchisee' AND (v_owner IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.machines machine WHERE machine.odoo_warehouse_id = p_odoo_warehouse_id
        AND public.current_machine_franchisee(machine.id) = v_owner
    )) THEN RAISE EXCEPTION 'Warehouse access denied'; END IF;
  ELSE
    IF NULLIF(btrim(p_location_text), '') IS NULL THEN RAISE EXCEPTION 'Enter a location'; END IF;
    v_owner := CASE WHEN v_profile.role = 'franchisee' THEN v_profile.tenant_id ELSE p_owning_tenant_id END;
    IF v_profile.role = 'franchisee' AND v_owner IS NULL THEN RAISE EXCEPTION 'Franchisee account required'; END IF;
  END IF;

  v_assigned_tenant := CASE WHEN v_profile.role = 'franchisee' THEN v_profile.tenant_id ELSE p_assigned_tenant_id END;
  IF p_assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles assignee WHERE assignee.id = p_assigned_user_id
      AND (v_profile.role = 'admin' OR assignee.tenant_id = v_profile.tenant_id)
  ) THEN RAISE EXCEPTION 'Assignee not available'; END IF;

  INSERT INTO public.incidents (
    scope_kind, machine_id, odoo_warehouse_id, location_text, owning_tenant_id,
    incident_type, source_kind, title, description, severity, due_at, created_by,
    assigned_tenant_id, assigned_user_id
  ) VALUES (
    p_scope_kind, CASE WHEN p_scope_kind = 'machine' THEN p_machine_id END,
    CASE WHEN p_scope_kind = 'warehouse' THEN p_odoo_warehouse_id END,
    CASE WHEN p_scope_kind = 'location' THEN btrim(p_location_text) END, v_owner,
    p_incident_type, 'manual', btrim(p_title), NULLIF(btrim(p_description), ''), p_severity, p_due_at, p_actor_id,
    v_assigned_tenant, p_assigned_user_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_incident_assignment(
  p_incident_id UUID, p_assigned_tenant_id UUID, p_assigned_user_id UUID, p_due_at TIMESTAMPTZ, p_actor_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_incident public.incidents%ROWTYPE; v_tenant UUID;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_actor_id;
  SELECT * INTO v_incident FROM public.incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND OR v_incident.status NOT IN ('open', 'in_progress') OR NOT public.incident_actor_can_access(p_incident_id, p_actor_id) THEN RAISE EXCEPTION 'Active incident not found'; END IF;
  IF v_profile.role NOT IN ('admin', 'franchisee') THEN RAISE EXCEPTION 'Assignment denied'; END IF;
  v_tenant := CASE WHEN v_profile.role = 'franchisee' THEN v_profile.tenant_id ELSE p_assigned_tenant_id END;
  IF v_tenant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND kind = 'franchisee') THEN RAISE EXCEPTION 'Franchisee not found'; END IF;
  IF p_assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles assignee WHERE assignee.id = p_assigned_user_id
      AND (v_profile.role = 'admin' OR assignee.tenant_id = v_profile.tenant_id)
  ) THEN RAISE EXCEPTION 'Assignee not available'; END IF;
  UPDATE public.incidents SET assigned_tenant_id = v_tenant, assigned_user_id = p_assigned_user_id, due_at = p_due_at, updated_at = now() WHERE id = p_incident_id;
  INSERT INTO public.incident_events (incident_id, event_type, actor_id, from_status, to_status, message, metadata)
  VALUES (p_incident_id, 'assigned', p_actor_id, v_incident.status, v_incident.status, 'Responsibility or schedule updated.',
    jsonb_build_object('assigned_tenant_id', v_tenant, 'assigned_user_id', p_assigned_user_id, 'due_at', p_due_at));
END;
$$;

CREATE OR REPLACE FUNCTION public.start_incident(p_incident_id UUID, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.incident_actor_can_access(p_incident_id, p_actor_id) THEN RAISE EXCEPTION 'Incident access denied'; END IF;
  UPDATE public.incidents SET status = 'in_progress', updated_at = now() WHERE id = p_incident_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Open incident not found'; END IF;
  INSERT INTO public.incident_events (incident_id, event_type, actor_id, from_status, to_status, message)
  VALUES (p_incident_id, 'started', p_actor_id, 'open', 'in_progress', 'Work started.');
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_incident(p_incident_id UUID, p_resolution_summary TEXT, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_incident public.incidents%ROWTYPE; v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_incident FROM public.incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND OR v_incident.status NOT IN ('open', 'in_progress') OR NOT public.incident_actor_can_access(p_incident_id, p_actor_id) THEN RAISE EXCEPTION 'Active incident not found'; END IF;
  IF NULLIF(btrim(p_resolution_summary), '') IS NULL OR char_length(btrim(p_resolution_summary)) > 2000 THEN RAISE EXCEPTION 'Describe how the incident was resolved'; END IF;
  IF v_incident.source_kind = 'alert' AND v_incident.source_alert_resolved_at IS NULL THEN RAISE EXCEPTION 'Telemetry still reports this alert as active'; END IF;
  UPDATE public.incidents SET status = 'resolved', resolution_summary = btrim(p_resolution_summary), resolved_at = v_now,
    resolved_by = p_actor_id, closed_at = v_now, closed_by = p_actor_id, closure_kind = 'incident_report',
    closing_action_report_id = NULL, updated_at = v_now WHERE id = p_incident_id;
  INSERT INTO public.incident_events (incident_id, event_type, actor_id, from_status, to_status, message)
  VALUES (p_incident_id, 'resolved', p_actor_id, v_incident.status, 'resolved', btrim(p_resolution_summary));
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_incident(p_incident_id UUID, p_reason TEXT, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_incident public.incidents%ROWTYPE;
BEGIN
  SELECT * INTO v_incident FROM public.incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND OR v_incident.status NOT IN ('resolved', 'closed') OR NOT public.incident_actor_can_access(p_incident_id, p_actor_id) THEN RAISE EXCEPTION 'Resolved incident not found'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Enter a reason for reopening'; END IF;
  UPDATE public.incidents SET status = 'open', resolution_summary = NULL, resolved_at = NULL, resolved_by = NULL,
    closed_at = NULL, closed_by = NULL, closure_kind = NULL, closing_action_report_id = NULL, updated_at = now()
  WHERE id = p_incident_id;
  INSERT INTO public.incident_events (incident_id, event_type, actor_id, from_status, to_status, message)
  VALUES (p_incident_id, 'reopened', p_actor_id, v_incident.status, 'open', btrim(p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_alert_incident()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_policy public.incident_type_policies%ROWTYPE; v_assignee UUID; v_owner UUID; v_id UUID; v_previous_status TEXT;
BEGIN
  IF NEW.machine_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_policy FROM public.incident_type_policies WHERE incident_type = NEW.type AND auto_create_from_alert;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_owner := public.current_machine_franchisee(NEW.machine_id);
  IF v_policy.auto_assign_to_franchisee THEN v_assignee := v_owner; END IF;
  SELECT id, status INTO v_id, v_previous_status FROM public.incidents WHERE source_alert_id = NEW.id FOR UPDATE;
  INSERT INTO public.incidents (
    scope_kind, machine_id, owning_tenant_id, incident_type, source_kind, source_alert_id, source_alert_resolved_at,
    title, description, severity, assigned_tenant_id, opened_at
  ) VALUES (
    'machine', NEW.machine_id, v_owner, NEW.type, 'alert', NEW.id, NEW.resolved_at,
    NEW.title, NEW.message, CASE WHEN NEW.severity IN ('info', 'warning', 'critical') THEN NEW.severity ELSE 'warning' END, v_assignee, NEW.created_at
  ) ON CONFLICT (source_alert_id) DO UPDATE SET
    source_alert_resolved_at = EXCLUDED.source_alert_resolved_at, title = EXCLUDED.title, description = EXCLUDED.description,
    severity = EXCLUDED.severity, owning_tenant_id = EXCLUDED.owning_tenant_id,
    assigned_tenant_id = COALESCE(incidents.assigned_tenant_id, EXCLUDED.assigned_tenant_id),
    status = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN 'open' ELSE incidents.status END,
    resolution_summary = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN NULL ELSE incidents.resolution_summary END,
    resolved_at = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN NULL ELSE incidents.resolved_at END,
    resolved_by = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN NULL ELSE incidents.resolved_by END,
    closed_at = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN NULL ELSE incidents.closed_at END,
    closed_by = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN NULL ELSE incidents.closed_by END,
    closure_kind = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN NULL ELSE incidents.closure_kind END,
    closing_action_report_id = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status IN ('resolved', 'closed') THEN NULL ELSE incidents.closing_action_report_id END,
    updated_at = now()
  RETURNING id INTO v_id;
  IF v_previous_status IS NOT NULL AND NEW.resolved_at IS NULL AND v_previous_status IN ('resolved', 'closed') THEN
    INSERT INTO public.incident_events (incident_id, event_type, from_status, to_status, message) VALUES (v_id, 'reopened', v_previous_status, 'open', 'The source alert became active again.');
  ELSIF v_previous_status IS NOT NULL THEN
    INSERT INTO public.incident_events (incident_id, event_type, from_status, to_status, message) VALUES (v_id, 'alert_updated', v_previous_status, v_previous_status, CASE WHEN NEW.resolved_at IS NULL THEN 'Source alert updated.' ELSE 'Source alert telemetry cleared.' END);
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.close_incident_without_report(UUID, UUID);
DROP FUNCTION IF EXISTS public.assign_incident(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.record_service_action_report_with_incidents(
  p_client_uuid UUID, p_machine_id UUID, p_operator_id UUID, p_occurred_at TIMESTAMPTZ,
  p_action_kind TEXT, p_status TEXT, p_notes TEXT, p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER, p_refill_lines JSONB, p_source TEXT, p_action_modes TEXT[], p_incident_ids UUID[]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB; v_report_id UUID; v_existing_status TEXT; v_ids UUID[]; v_linked UUID[]; v_role TEXT; v_tenant UUID; v_valid_count INTEGER; v_now TIMESTAMPTZ := now();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));
  v_ids := ARRAY(SELECT DISTINCT id FROM unnest(COALESCE(p_incident_ids, ARRAY[]::UUID[])) id ORDER BY id);
  IF cardinality(v_ids) > 20 THEN RAISE EXCEPTION 'A report can link at most 20 incidents'; END IF;
  SELECT status INTO v_existing_status FROM public.service_action_reports WHERE client_uuid = p_client_uuid;
  SELECT public.record_service_action_report(p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, p_action_kind, p_status, p_notes,
    p_cleaning_material_used, p_water_bucket_count, p_refill_lines, p_source, p_action_modes) INTO v_result;
  v_report_id := (v_result->>'id')::UUID;
  SELECT role, tenant_id INTO v_role, v_tenant FROM public.profiles WHERE id = p_operator_id;
  IF cardinality(v_ids) > 0 AND v_role NOT IN ('admin', 'franchisee', 'operator') THEN RAISE EXCEPTION 'Incident access denied'; END IF;
  IF v_existing_status = 'confirmed' THEN
    SELECT COALESCE(array_agg(incident_id ORDER BY incident_id), ARRAY[]::UUID[]) INTO v_linked FROM public.service_action_report_incidents WHERE report_id = v_report_id;
    IF v_linked IS DISTINCT FROM v_ids THEN RAISE EXCEPTION 'Confirmed report incident links cannot change'; END IF;
    RETURN v_result || jsonb_build_object('closed_incidents', cardinality(v_ids));
  END IF;
  PERFORM incident.id FROM public.incidents incident WHERE incident.id = ANY(v_ids) ORDER BY incident.id FOR UPDATE;
  SELECT count(*) INTO v_valid_count FROM public.incidents incident WHERE incident.id = ANY(v_ids)
    AND incident.scope_kind = 'machine' AND incident.machine_id = p_machine_id AND incident.status IN ('open', 'in_progress')
    AND (v_role = 'admin' OR public.incident_actor_can_access(incident.id, p_operator_id));
  IF v_valid_count <> cardinality(v_ids) THEN RAISE EXCEPTION 'One or more incidents are unavailable for this report'; END IF;
  DELETE FROM public.service_action_report_incidents WHERE report_id = v_report_id;
  INSERT INTO public.service_action_report_incidents (report_id, incident_id, linked_by, closes_incident)
  SELECT v_report_id, id, p_operator_id, p_status = 'confirmed' FROM unnest(v_ids) id;
  IF p_status = 'confirmed' THEN
    INSERT INTO public.incident_events (incident_id, event_type, actor_id, from_status, to_status, message, metadata)
    SELECT id, 'action_report_linked', p_operator_id, status, 'resolved',
      CASE WHEN NULLIF(btrim(p_notes), '') IS NULL THEN 'Resolved through Action Report.' ELSE 'Resolved through Action Report: ' || btrim(p_notes) END,
      jsonb_build_object('report_id', v_report_id)
    FROM public.incidents WHERE id = ANY(v_ids) AND status IN ('open', 'in_progress');
    UPDATE public.incidents SET status = 'resolved',
      resolution_summary = CASE WHEN NULLIF(btrim(p_notes), '') IS NULL THEN 'Resolved through Action Report.' ELSE 'Resolved through Action Report: ' || btrim(p_notes) END,
      resolved_at = v_now,
      resolved_by = p_operator_id, closed_at = v_now, closed_by = p_operator_id, closure_kind = 'action_report',
      closing_action_report_id = v_report_id, updated_at = v_now WHERE id = ANY(v_ids) AND status IN ('open', 'in_progress');
  END IF;
  RETURN v_result || jsonb_build_object('closed_incidents', CASE WHEN p_status = 'confirmed' THEN cardinality(v_ids) ELSE 0 END);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_scheduled_refill_incidents()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO public.incidents (
    scope_kind, machine_id, owning_tenant_id, incident_type, source_kind, title, description, severity,
    assigned_tenant_id, due_at, opened_at
  )
  SELECT 'machine', machine.id, public.current_machine_franchisee(machine.id), 'scheduled_refill', 'schedule', 'Refill overdue',
         'More than 14 days have passed since the last recorded refill.', 'critical',
         CASE WHEN policy.auto_assign_to_franchisee THEN public.current_machine_franchisee(machine.id) END,
         machine.last_refill_at + INTERVAL '14 days', now()
  FROM public.machines machine
  JOIN public.incident_type_policies policy ON policy.incident_type = 'scheduled_refill'
  WHERE machine.deployed AND machine.last_refill_at IS NOT NULL
    AND machine.last_refill_at < now() - INTERVAL '14 days'
  ON CONFLICT (machine_id, incident_type) WHERE status IN ('open', 'in_progress') AND source_kind = 'schedule' DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, severity = EXCLUDED.severity,
    due_at = EXCLUDED.due_at, owning_tenant_id = EXCLUDED.owning_tenant_id,
    assigned_tenant_id = COALESCE(incidents.assigned_tenant_id, EXCLUDED.assigned_tenant_id), updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_refill_incident(p_machine_id UUID, p_actor_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_machine public.machines%ROWTYPE; v_id UUID; v_assign BOOLEAN; v_assignee UUID; v_owner UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT * INTO v_machine FROM public.machines WHERE id = p_machine_id AND deployed FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deployed machine not found'; END IF;
  IF v_machine.last_refill_at IS NULL THEN RAISE EXCEPTION 'No refill has been recorded for this machine'; END IF;
  IF v_machine.last_refill_at > now() - INTERVAL '7 days' THEN RAISE EXCEPTION 'A refill is not due yet'; END IF;
  v_owner := public.current_machine_franchisee(p_machine_id);
  SELECT auto_assign_to_franchisee INTO v_assign FROM public.incident_type_policies WHERE incident_type = 'scheduled_refill';
  IF v_assign THEN v_assignee := v_owner; END IF;
  INSERT INTO public.incidents (scope_kind, machine_id, owning_tenant_id, incident_type, source_kind, title, description, severity, assigned_tenant_id, due_at, created_by)
  VALUES ('machine', p_machine_id, v_owner, 'scheduled_refill', 'schedule', 'Refill due soon', 'More than 7 days have passed since the last recorded refill.',
    CASE WHEN v_machine.last_refill_at < now() - INTERVAL '14 days' THEN 'critical' ELSE 'warning' END,
    v_assignee, v_machine.last_refill_at + INTERVAL '14 days', p_actor_id)
  ON CONFLICT (machine_id, incident_type) WHERE status IN ('open', 'in_progress') AND source_kind = 'schedule'
  DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, severity = EXCLUDED.severity,
    due_at = EXCLUDED.due_at, owning_tenant_id = EXCLUDED.owning_tenant_id,
    assigned_tenant_id = COALESCE(incidents.assigned_tenant_id, EXCLUDED.assigned_tenant_id), updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_incident_type_auto_assignment(p_incident_type TEXT, p_enabled BOOLEAN, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  UPDATE public.incident_type_policies SET auto_assign_to_franchisee = p_enabled, updated_by = p_actor_id, updated_at = now()
  WHERE incident_type = p_incident_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'Incident type not found'; END IF;
  IF p_enabled THEN
    UPDATE public.incidents incident SET assigned_tenant_id = public.current_machine_franchisee(incident.machine_id), updated_at = now()
    WHERE incident.incident_type = p_incident_type AND incident.scope_kind = 'machine'
      AND incident.status IN ('open', 'in_progress') AND incident.assigned_tenant_id IS NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.incident_actor_can_access(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.incident_actor_can_access(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.current_actor_can_access_incident(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_actor_can_access_incident(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_incident(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_incident_assignment(UUID, UUID, UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_incident(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_incident(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reopen_incident(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_incident_created_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_incident(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_incident_assignment(UUID, UUID, UUID, TIMESTAMPTZ, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_incident(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_incident(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_incident(UUID, TEXT, UUID) TO service_role;
