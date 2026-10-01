CREATE TABLE public.franchisee_payout_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_month DATE NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  calculated_total_cents BIGINT NOT NULL CHECK (calculated_total_cents >= 0),
  paid_total_cents BIGINT CHECK (paid_total_cents IS NULL OR paid_total_cents >= 0),
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  payment_reference TEXT CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month),
  CHECK (
    (status = 'pending' AND paid_total_cents IS NULL AND paid_at IS NULL AND paid_by IS NULL)
    OR
    (status = 'paid' AND paid_total_cents IS NOT NULL AND paid_at IS NOT NULL AND paid_by IS NOT NULL)
  )
);

CREATE INDEX franchisee_payout_settlements_period_idx
  ON public.franchisee_payout_settlements (period_month DESC, tenant_id);

CREATE TRIGGER franchisee_payout_settlements_set_updated_at
BEFORE UPDATE ON public.franchisee_payout_settlements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.franchisee_payout_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.franchisee_payout_settlements FROM PUBLIC, anon, authenticated;
