CREATE TABLE public.machine_menu_snapshots (
  device_imei TEXT PRIMARY KEY,
  machine_id UUID REFERENCES public.machines(id) ON DELETE SET NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_menu_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.machine_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  machine_id UUID REFERENCES public.machines(id) ON DELETE SET NULL,
  device_imei TEXT,
  machine_name TEXT,
  source TEXT NOT NULL CHECK (source IN ('machine_sync', 'platform', 'odoo')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT,
  field TEXT,
  old_value JSONB,
  new_value JSONB,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX machine_change_log_created_idx ON public.machine_change_log (created_at DESC);
CREATE INDEX machine_change_log_machine_idx ON public.machine_change_log (device_imei, created_at DESC);
CREATE INDEX machine_change_log_field_idx ON public.machine_change_log (field, created_at DESC);

ALTER TABLE public.machine_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY machine_change_log_admin_read
  ON public.machine_change_log
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_current_admin()));

REVOKE INSERT, UPDATE, DELETE ON public.machine_change_log FROM anon, authenticated;
REVOKE ALL ON public.machine_menu_snapshots FROM anon, authenticated;
GRANT SELECT ON public.machine_change_log TO authenticated;
