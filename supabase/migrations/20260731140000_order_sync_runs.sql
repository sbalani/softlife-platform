CREATE TABLE public.order_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('orders_page', 'settings', 'cron')),
  requested_from DATE NOT NULL,
  requested_to DATE NOT NULL,
  requested_device_imeis TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  machines_total INTEGER NOT NULL DEFAULT 0 CHECK (machines_total >= 0),
  machines_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (machines_succeeded >= 0),
  machines_failed INTEGER NOT NULL DEFAULT 0 CHECK (machines_failed >= 0),
  orders_fetched INTEGER NOT NULL DEFAULT 0 CHECK (orders_fetched >= 0),
  error TEXT,
  CHECK (requested_to >= requested_from),
  CHECK ((status = 'running' AND finished_at IS NULL) OR (status <> 'running' AND finished_at IS NOT NULL))
);

CREATE TABLE public.order_sync_machine_results (
  run_id UUID NOT NULL REFERENCES public.order_sync_runs(id) ON DELETE CASCADE,
  machine_id UUID REFERENCES public.machines(id) ON DELETE SET NULL,
  device_imei TEXT NOT NULL,
  machine_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  orders_fetched INTEGER NOT NULL DEFAULT 0 CHECK (orders_fetched >= 0),
  fresh_through DATE,
  error TEXT,
  PRIMARY KEY (run_id, device_imei),
  CHECK (
    (status = 'succeeded' AND fresh_through IS NOT NULL AND error IS NULL)
    OR (status = 'failed' AND fresh_through IS NULL AND error IS NOT NULL)
  )
);

CREATE INDEX order_sync_runs_started_idx ON public.order_sync_runs (started_at DESC);
CREATE INDEX order_sync_machine_latest_idx ON public.order_sync_machine_results (device_imei, finished_at DESC);
CREATE INDEX order_sync_machine_success_idx ON public.order_sync_machine_results (device_imei, fresh_through DESC, finished_at DESC) WHERE status = 'succeeded';

ALTER TABLE public.order_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_sync_machine_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_sync_runs_admin_read ON public.order_sync_runs
  FOR SELECT TO authenticated USING ((SELECT public.is_current_admin()));
CREATE POLICY order_sync_machine_results_admin_read ON public.order_sync_machine_results
  FOR SELECT TO authenticated USING ((SELECT public.is_current_admin()));

REVOKE INSERT, UPDATE, DELETE ON public.order_sync_runs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_sync_machine_results FROM anon, authenticated;
GRANT SELECT ON public.order_sync_runs, public.order_sync_machine_results TO authenticated;
