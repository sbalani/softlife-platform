CREATE TABLE public.coupon_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  coupon_type TEXT NOT NULL CHECK (coupon_type IN ('0', '1')),
  coupon_name TEXT NOT NULL CHECK (length(trim(coupon_name)) > 0),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  valid_day INTEGER NOT NULL CHECK (valid_day >= 1),
  total_count INTEGER NOT NULL CHECK (total_count BETWEEN 0 AND 100),
  uses_per_code INTEGER NOT NULL CHECK (uses_per_code >= 1),
  local_name TEXT NOT NULL CHECK (length(trim(local_name)) > 0),
  money NUMERIC,
  amount INTEGER,
  product_position TEXT,
  product_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granting', 'granted', 'rejected', 'failed')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  huaxin_coupon_id TEXT,
  grant_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (
    (coupon_type = '0' AND money > 0 AND amount IS NULL AND product_position IS NULL AND product_name IS NULL)
    OR
    (coupon_type = '1' AND money IS NULL AND amount >= 1 AND length(trim(product_position)) > 0 AND length(trim(product_name)) > 0)
  ),
  CHECK ((status = 'granted' AND huaxin_coupon_id IS NOT NULL) OR status <> 'granted')
);

CREATE TABLE public.coupon_request_machines (
  request_id UUID NOT NULL REFERENCES public.coupon_requests(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  PRIMARY KEY (request_id, machine_id)
);

CREATE INDEX coupon_requests_tenant_created_idx ON public.coupon_requests (tenant_id, created_at DESC);
CREATE INDEX coupon_requests_status_created_idx ON public.coupon_requests (status, created_at DESC);
CREATE INDEX coupon_request_machines_machine_idx ON public.coupon_request_machines (machine_id);

ALTER TABLE public.coupon_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_request_machines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_requests, public.coupon_request_machines FROM anon, authenticated;
