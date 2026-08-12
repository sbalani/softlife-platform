CREATE TABLE public.franchisee_intake_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX franchisee_intake_status_created_idx
  ON public.franchisee_intake_submissions (status, created_at DESC);

ALTER TABLE public.franchisee_intake_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.franchisee_intake_submissions FROM anon, authenticated;
