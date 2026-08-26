ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS address_line_1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line_2 TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT;

CREATE TABLE public.tenant_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 150),
  job_title TEXT CHECK (job_title IS NULL OR char_length(job_title) <= 150),
  email TEXT CHECK (email IS NULL OR char_length(email) <= 254),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 40),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX tenant_contacts_tenant_idx ON public.tenant_contacts (tenant_id, is_primary DESC, full_name);

CREATE TABLE public.franchisee_signup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 150),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 40),
  company_name TEXT CHECK (company_name IS NULL OR char_length(company_name) <= 150),
  message TEXT CHECK (message IS NULL OR char_length(message) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'approved', 'rejected')),
  assigned_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  approved_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX franchisee_signup_status_created_idx ON public.franchisee_signup_requests (status, created_at DESC);
CREATE UNIQUE INDEX franchisee_signup_one_open_email_idx ON public.franchisee_signup_requests (lower(email)) WHERE status IN ('pending', 'processing');

ALTER TABLE public.tenant_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchisee_signup_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tenant_contacts, public.franchisee_signup_requests FROM anon, authenticated;
