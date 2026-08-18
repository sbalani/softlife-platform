ALTER TABLE public.lot_usages
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;

UPDATE public.lot_usages lu SET tenant_id = r.tenant_id
FROM public.reposiciones r
WHERE lu.tenant_id IS NULL AND lu.reposicion_id = r.id;

UPDATE public.lot_usages lu SET tenant_id = COALESCE(
  (
    SELECT assignment.tenant_id
    FROM public.machine_franchisee_assignments assignment
    WHERE assignment.machine_id = lu.machine_id
    AND assignment.start_date <= (lu.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
    AND (assignment.end_date IS NULL OR assignment.end_date >= (lu.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
    ORDER BY assignment.start_date DESC LIMIT 1
  ),
  (SELECT machine.tenant_id FROM public.machines machine WHERE machine.id = lu.machine_id)
)
WHERE lu.tenant_id IS NULL AND lu.machine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lot_usages_tenant_time_idx ON public.lot_usages(tenant_id, device_event_time DESC);

CREATE OR REPLACE FUNCTION public.set_lot_usage_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.reposicion_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.reposiciones WHERE id = NEW.reposicion_id;
  END IF;
  IF NEW.tenant_id IS NULL AND NEW.machine_id IS NOT NULL THEN
    SELECT assignment.tenant_id INTO NEW.tenant_id
    FROM public.machine_franchisee_assignments assignment
    WHERE assignment.machine_id = NEW.machine_id
      AND assignment.start_date <= (NEW.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE
      AND (assignment.end_date IS NULL OR assignment.end_date >= (NEW.device_event_time AT TIME ZONE 'Europe/Madrid')::DATE)
    ORDER BY assignment.start_date DESC LIMIT 1;
    IF NEW.tenant_id IS NULL THEN
      SELECT tenant_id INTO NEW.tenant_id FROM public.machines WHERE id = NEW.machine_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lot_usages_set_tenant ON public.lot_usages;
CREATE TRIGGER lot_usages_set_tenant
BEFORE INSERT OR UPDATE OF machine_id, reposicion_id, device_event_time ON public.lot_usages
FOR EACH ROW EXECUTE FUNCTION public.set_lot_usage_tenant();

DROP POLICY IF EXISTS lot_usages_read ON public.lot_usages;
CREATE POLICY lot_usages_read ON public.lot_usages FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND (profile.role = 'admin' OR profile.tenant_id = lot_usages.tenant_id)
  )
);
