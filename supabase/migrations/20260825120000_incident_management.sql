ALTER TABLE public.machines ADD COLUMN last_refill_at TIMESTAMPTZ;

CREATE TABLE public.incident_type_policies (
  incident_type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  auto_create_from_alert BOOLEAN NOT NULL DEFAULT true,
  auto_assign_to_franchisee BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.incident_type_policies (incident_type, label, auto_create_from_alert) VALUES
  ('cup_empty', 'Cup shortage', true),
  ('cup_foreign_object', 'Foreign object in cup holder', true),
  ('cup_blocked', 'Cup dispenser blocked', true),
  ('cup_take_fault', 'Cup pickup fault', true),
  ('material_remaining_critical', 'Low stock', true),
  ('stock', 'Product stock', true),
  ('compressor_overheat', 'Compressor overheating', true),
  ('temperature', 'Temperature issue', true),
  ('ordering_system_fault', 'Ordering system fault', true),
  ('mixture_ratio_fault', 'Mixture ratio fault', true),
  ('device_online', 'Machine offline', true),
  ('defrost_automation_failed', 'Defrost intervention', true),
  ('scheduled_refill', 'Scheduled refill', false);

CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  incident_type TEXT NOT NULL REFERENCES public.incident_type_policies(incident_type),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('alert', 'schedule', 'manual')),
  source_alert_id UUID UNIQUE REFERENCES public.alerts(id) ON DELETE RESTRICT,
  source_alert_resolved_at TIMESTAMPTZ,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closure_kind TEXT CHECK (closure_kind IS NULL OR closure_kind IN ('action_report', 'no_report')),
  closing_action_report_id UUID REFERENCES public.service_action_reports(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'open' AND closed_at IS NULL AND closure_kind IS NULL AND closing_action_report_id IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND closure_kind IS NOT NULL))
);

CREATE UNIQUE INDEX incidents_one_open_scheduled_type
  ON public.incidents (machine_id, incident_type)
  WHERE status = 'open' AND source_kind = 'schedule';
CREATE INDEX incidents_open_machine_idx ON public.incidents (machine_id, opened_at DESC) WHERE status = 'open';
CREATE INDEX incidents_assigned_tenant_idx ON public.incidents (assigned_tenant_id, status, opened_at DESC);

CREATE TABLE public.service_action_report_incidents (
  report_id UUID NOT NULL REFERENCES public.service_action_reports(id) ON DELETE RESTRICT,
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE RESTRICT,
  linked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_incident BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (report_id, incident_id)
);
CREATE INDEX service_action_report_incidents_incident_idx ON public.service_action_report_incidents (incident_id, linked_at DESC);
CREATE UNIQUE INDEX service_action_report_incidents_one_closure
  ON public.service_action_report_incidents (incident_id) WHERE closes_incident;

ALTER TABLE public.incident_type_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_report_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY incident_type_policies_read ON public.incident_type_policies FOR SELECT TO authenticated USING (true);
CREATE POLICY incidents_read ON public.incidents FOR SELECT TO authenticated USING (
  (SELECT public.is_current_admin()) OR EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid() AND profile.role = 'franchisee' AND profile.tenant_id = assigned_tenant_id
  )
);
CREATE POLICY service_action_report_incidents_read ON public.service_action_report_incidents FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.incidents incident WHERE incident.id = service_action_report_incidents.incident_id)
);

REVOKE INSERT, UPDATE, DELETE ON public.incident_type_policies, public.incidents, public.service_action_report_incidents FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.alerts FROM anon, authenticated;
GRANT SELECT ON public.incident_type_policies, public.incidents, public.service_action_report_incidents TO authenticated;

CREATE OR REPLACE FUNCTION public.current_machine_franchisee(p_machine_id UUID, p_day DATE DEFAULT (now() AT TIME ZONE 'Europe/Madrid')::DATE)
RETURNS UUID LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT COALESCE((
    SELECT assignment.tenant_id
    FROM public.machine_franchisee_assignments assignment
    WHERE assignment.machine_id = machine.id
      AND assignment.start_date <= p_day
      AND (assignment.end_date IS NULL OR assignment.end_date >= p_day)
    ORDER BY assignment.start_date DESC
    LIMIT 1
  ), machine.tenant_id)
  FROM public.machines machine WHERE machine.id = p_machine_id
$$;

CREATE OR REPLACE FUNCTION public.sync_alert_incident()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy public.incident_type_policies%ROWTYPE;
  v_assignee UUID;
BEGIN
  IF NEW.machine_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_policy FROM public.incident_type_policies WHERE incident_type = NEW.type AND auto_create_from_alert;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_policy.auto_assign_to_franchisee THEN v_assignee := public.current_machine_franchisee(NEW.machine_id); END IF;
  IF NEW.resolved_at IS NULL THEN
    UPDATE public.service_action_report_incidents link SET closes_incident = false
    FROM public.incidents incident
    WHERE incident.source_alert_id = NEW.id AND incident.status = 'closed' AND link.incident_id = incident.id AND link.closes_incident;
  END IF;
  INSERT INTO public.incidents (
    machine_id, incident_type, source_kind, source_alert_id, source_alert_resolved_at,
    title, description, severity, assigned_tenant_id, opened_at
  ) VALUES (
    NEW.machine_id, NEW.type, 'alert', NEW.id, NEW.resolved_at,
    NEW.title, NEW.message, CASE WHEN NEW.severity IN ('info', 'warning', 'critical') THEN NEW.severity ELSE 'warning' END, v_assignee, NEW.created_at
  )
  ON CONFLICT (source_alert_id) DO UPDATE SET
    source_alert_resolved_at = EXCLUDED.source_alert_resolved_at,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    severity = EXCLUDED.severity,
    assigned_tenant_id = COALESCE(incidents.assigned_tenant_id, EXCLUDED.assigned_tenant_id),
    status = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status = 'closed' THEN 'open' ELSE incidents.status END,
    closed_at = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status = 'closed' THEN NULL ELSE incidents.closed_at END,
    closed_by = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status = 'closed' THEN NULL ELSE incidents.closed_by END,
    closure_kind = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status = 'closed' THEN NULL ELSE incidents.closure_kind END,
    closing_action_report_id = CASE WHEN EXCLUDED.source_alert_resolved_at IS NULL AND incidents.status = 'closed' THEN NULL ELSE incidents.closing_action_report_id END,
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER alerts_sync_incident
AFTER INSERT OR UPDATE OF resolved_at, title, message, severity ON public.alerts
FOR EACH ROW EXECUTE FUNCTION public.sync_alert_incident();

INSERT INTO public.incidents (
  machine_id, incident_type, source_kind, source_alert_id, source_alert_resolved_at,
  title, description, severity, assigned_tenant_id, opened_at
)
SELECT alert.machine_id, alert.type, 'alert', alert.id, alert.resolved_at,
       alert.title, alert.message, CASE WHEN alert.severity IN ('info', 'warning', 'critical') THEN alert.severity ELSE 'warning' END,
       CASE WHEN policy.auto_assign_to_franchisee THEN public.current_machine_franchisee(alert.machine_id) END,
       alert.created_at
FROM public.alerts alert
JOIN public.incident_type_policies policy ON policy.incident_type = alert.type AND policy.auto_create_from_alert
WHERE alert.machine_id IS NOT NULL AND alert.resolved_at IS NULL
ON CONFLICT (source_alert_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.recalculate_machine_last_refill(p_machine_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.machines machine SET last_refill_at = (
    SELECT max(event_time) FROM (
      SELECT report.occurred_at AS event_time
      FROM public.service_action_reports report
      WHERE report.machine_id = p_machine_id AND report.status = 'confirmed' AND 'refill' = ANY(report.action_modes)
      UNION ALL
      SELECT refill.device_event_time
      FROM public.reposiciones refill
      WHERE refill.machine_id = p_machine_id AND refill.service_action_report_id IS NULL AND refill.status = 'synced'
    ) refill_events
  ) WHERE machine.id = p_machine_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_last_refill_from_report()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_machine_id UUID;
BEGIN
  v_machine_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.machine_id ELSE NEW.machine_id END;
  PERFORM public.recalculate_machine_last_refill(v_machine_id);
  IF TG_OP = 'UPDATE' AND NEW.machine_id IS DISTINCT FROM OLD.machine_id THEN PERFORM public.recalculate_machine_last_refill(OLD.machine_id); END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER service_action_reports_refresh_last_refill
AFTER INSERT OR UPDATE OF machine_id, occurred_at, status, action_modes OR DELETE ON public.service_action_reports
FOR EACH ROW EXECUTE FUNCTION public.refresh_last_refill_from_report();

CREATE OR REPLACE FUNCTION public.refresh_last_refill_from_legacy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_machine_id UUID;
BEGIN
  v_machine_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.machine_id ELSE NEW.machine_id END;
  PERFORM public.recalculate_machine_last_refill(v_machine_id);
  IF TG_OP = 'UPDATE' AND NEW.machine_id IS DISTINCT FROM OLD.machine_id THEN PERFORM public.recalculate_machine_last_refill(OLD.machine_id); END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER reposiciones_refresh_last_refill
AFTER INSERT OR UPDATE OF machine_id, device_event_time, status, service_action_report_id OR DELETE ON public.reposiciones
FOR EACH ROW EXECUTE FUNCTION public.refresh_last_refill_from_legacy();

UPDATE public.machines machine SET last_refill_at = (
  SELECT max(event_time) FROM (
    SELECT report.occurred_at AS event_time
    FROM public.service_action_reports report
    WHERE report.machine_id = machine.id AND report.status = 'confirmed' AND 'refill' = ANY(report.action_modes)
    UNION ALL
    SELECT refill.device_event_time
    FROM public.reposiciones refill
    WHERE refill.machine_id = machine.id AND refill.service_action_report_id IS NULL AND refill.status = 'synced'
  ) refill_events
);

CREATE OR REPLACE FUNCTION public.refresh_scheduled_refill_incidents()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO public.incidents (
    machine_id, incident_type, source_kind, title, description, severity,
    assigned_tenant_id, due_at, opened_at
  )
  SELECT machine.id, 'scheduled_refill', 'schedule', 'Refill overdue',
         'More than 14 days have passed since the last recorded refill.', 'critical',
         CASE WHEN policy.auto_assign_to_franchisee THEN public.current_machine_franchisee(machine.id) END,
         machine.last_refill_at + INTERVAL '14 days', now()
  FROM public.machines machine
  JOIN public.incident_type_policies policy ON policy.incident_type = 'scheduled_refill'
  WHERE machine.deployed AND machine.last_refill_at IS NOT NULL
    AND machine.last_refill_at < now() - INTERVAL '14 days'
  ON CONFLICT (machine_id, incident_type) WHERE status = 'open' AND source_kind = 'schedule' DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, severity = EXCLUDED.severity,
    due_at = EXCLUDED.due_at, assigned_tenant_id = COALESCE(incidents.assigned_tenant_id, EXCLUDED.assigned_tenant_id), updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_refill_incident(p_machine_id UUID, p_actor_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_machine public.machines%ROWTYPE; v_id UUID; v_assign BOOLEAN; v_assignee UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT * INTO v_machine FROM public.machines WHERE id = p_machine_id AND deployed FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deployed machine not found'; END IF;
  IF v_machine.last_refill_at IS NULL THEN RAISE EXCEPTION 'No refill has been recorded for this machine'; END IF;
  IF v_machine.last_refill_at > now() - INTERVAL '7 days' THEN RAISE EXCEPTION 'A refill is not due yet'; END IF;
  SELECT auto_assign_to_franchisee INTO v_assign FROM public.incident_type_policies WHERE incident_type = 'scheduled_refill';
  IF v_assign THEN v_assignee := public.current_machine_franchisee(p_machine_id); END IF;
  INSERT INTO public.incidents (machine_id, incident_type, source_kind, title, description, severity, assigned_tenant_id, due_at, created_by)
  VALUES (p_machine_id, 'scheduled_refill', 'schedule', 'Refill due soon', 'More than 7 days have passed since the last recorded refill.',
    CASE WHEN v_machine.last_refill_at < now() - INTERVAL '14 days' THEN 'critical' ELSE 'warning' END,
    v_assignee, v_machine.last_refill_at + INTERVAL '14 days', p_actor_id)
  ON CONFLICT (machine_id, incident_type) WHERE status = 'open' AND source_kind = 'schedule'
  DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, severity = EXCLUDED.severity,
    due_at = EXCLUDED.due_at, assigned_tenant_id = COALESCE(incidents.assigned_tenant_id, EXCLUDED.assigned_tenant_id), updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_incident(p_incident_id UUID, p_tenant_id UUID, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND kind = 'franchisee') THEN RAISE EXCEPTION 'Franchisee not found'; END IF;
  UPDATE public.incidents SET assigned_tenant_id = p_tenant_id, updated_at = now() WHERE id = p_incident_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Open incident not found'; END IF;
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
    WHERE incident.incident_type = p_incident_type AND incident.status = 'open' AND incident.assigned_tenant_id IS NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_incident_without_report(p_incident_id UUID, p_actor_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT; v_tenant UUID; v_incident public.incidents%ROWTYPE;
BEGIN
  SELECT role, tenant_id INTO v_role, v_tenant FROM public.profiles WHERE id = p_actor_id;
  SELECT * INTO v_incident FROM public.incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND OR v_incident.status <> 'open' THEN RAISE EXCEPTION 'Open incident not found'; END IF;
  IF v_incident.source_kind = 'alert' AND v_incident.source_alert_resolved_at IS NULL THEN
    RAISE EXCEPTION 'Telemetry still reports this issue as active; complete an Action Report instead';
  END IF;
  IF v_role <> 'admin' AND NOT (v_role = 'franchisee' AND v_incident.assigned_tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'This incident requires an Action Report or admin review';
  END IF;
  UPDATE public.incidents SET status = 'closed', closed_at = now(), closed_by = p_actor_id,
    closure_kind = 'no_report', updated_at = now() WHERE id = p_incident_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_service_action_report_with_incidents(
  p_client_uuid UUID, p_machine_id UUID, p_operator_id UUID, p_occurred_at TIMESTAMPTZ,
  p_action_kind TEXT, p_status TEXT, p_notes TEXT, p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER, p_refill_lines JSONB, p_source TEXT, p_action_modes TEXT[],
  p_incident_ids UUID[]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB; v_report_id UUID; v_existing_status TEXT; v_ids UUID[]; v_linked UUID[];
  v_role TEXT; v_tenant UUID; v_valid_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_uuid::TEXT, 0));
  v_ids := ARRAY(SELECT DISTINCT id FROM unnest(COALESCE(p_incident_ids, ARRAY[]::UUID[])) id ORDER BY id);
  IF cardinality(v_ids) > 20 THEN RAISE EXCEPTION 'A report can link at most 20 incidents'; END IF;
  SELECT status INTO v_existing_status FROM public.service_action_reports WHERE client_uuid = p_client_uuid;
  SELECT public.record_service_action_report(
    p_client_uuid, p_machine_id, p_operator_id, p_occurred_at, p_action_kind, p_status, p_notes,
    p_cleaning_material_used, p_water_bucket_count, p_refill_lines, p_source, p_action_modes
  ) INTO v_result;
  v_report_id := (v_result->>'id')::UUID;
  SELECT role, tenant_id INTO v_role, v_tenant FROM public.profiles WHERE id = p_operator_id;
  IF cardinality(v_ids) > 0 AND v_role NOT IN ('admin', 'franchisee') THEN RAISE EXCEPTION 'Incident access denied'; END IF;
  IF v_existing_status = 'confirmed' THEN
    SELECT COALESCE(array_agg(incident_id ORDER BY incident_id), ARRAY[]::UUID[]) INTO v_linked
    FROM public.service_action_report_incidents WHERE report_id = v_report_id;
    IF v_linked IS DISTINCT FROM v_ids THEN RAISE EXCEPTION 'Confirmed report incident links cannot change'; END IF;
    RETURN v_result || jsonb_build_object('closed_incidents', cardinality(v_ids));
  END IF;
  PERFORM incident.id FROM public.incidents incident WHERE incident.id = ANY(v_ids) ORDER BY incident.id FOR UPDATE;
  SELECT count(*) INTO v_valid_count FROM public.incidents incident
  WHERE incident.id = ANY(v_ids) AND incident.machine_id = p_machine_id AND incident.status = 'open'
    AND (v_role = 'admin' OR incident.assigned_tenant_id = v_tenant);
  IF v_valid_count <> cardinality(v_ids) THEN RAISE EXCEPTION 'One or more incidents are unavailable for this report'; END IF;
  DELETE FROM public.service_action_report_incidents WHERE report_id = v_report_id;
  INSERT INTO public.service_action_report_incidents (report_id, incident_id, linked_by, closes_incident)
  SELECT v_report_id, id, p_operator_id, p_status = 'confirmed' FROM unnest(v_ids) id;
  IF p_status = 'confirmed' THEN
    UPDATE public.incidents SET status = 'closed', closed_at = now(), closed_by = p_operator_id,
      closure_kind = 'action_report', closing_action_report_id = v_report_id, updated_at = now()
    WHERE id = ANY(v_ids) AND status = 'open';
  END IF;
  RETURN v_result || jsonb_build_object('closed_incidents', CASE WHEN p_status = 'confirmed' THEN cardinality(v_ids) ELSE 0 END);
END;
$$;

SELECT public.refresh_scheduled_refill_incidents();

REVOKE ALL ON FUNCTION public.current_machine_franchisee(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_alert_incident() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_machine_last_refill(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_last_refill_from_report() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_last_refill_from_legacy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_scheduled_refill_incidents() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_refill_incident(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_incident(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_incident_type_auto_assignment(TEXT, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_incident_without_report(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_service_action_report_with_incidents(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, TEXT[], UUID[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.refresh_scheduled_refill_incidents() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_refill_incident(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_incident(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_incident_type_auto_assignment(TEXT, BOOLEAN, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_incident_without_report(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_service_action_report_with_incidents(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, TEXT[], UUID[]) TO service_role;

INSERT INTO public.change_alert_rules (name, field, rule_type, target_value, severity)
SELECT 'Compressor overheating', 'compressor_overheat', 'status_equals', 'true', 'critical'
WHERE NOT EXISTS (
  SELECT 1 FROM public.change_alert_rules WHERE field = 'compressor_overheat' AND machine_id IS NULL AND product_id IS NULL
);
