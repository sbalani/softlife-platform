CREATE TABLE IF NOT EXISTS public.machine_franchisee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  service_model TEXT NOT NULL DEFAULT 'customer_service'
    CHECK (service_model IN ('customer_service', 'softlife_service', 'custom')),
  share_percent NUMERIC(5,2) NOT NULL DEFAULT 26
    CHECK (share_percent >= 0 AND share_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS machine_franchisee_assignments_lookup_idx
  ON public.machine_franchisee_assignments (machine_id, start_date, end_date);

ALTER TABLE public.machine_franchisee_assignments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.vat_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_percent NUMERIC(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  effective_from DATE NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vat_rates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.vat_rates (rate_percent, effective_from)
VALUES (10, '1970-01-01')
ON CONFLICT (effective_from) DO NOTHING;
