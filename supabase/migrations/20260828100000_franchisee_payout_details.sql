CREATE TABLE public.tenant_bank_details (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_holder_name TEXT NOT NULL CHECK (char_length(account_holder_name) BETWEEN 1 AND 150),
  iban TEXT NOT NULL CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic_swift TEXT CHECK (bic_swift IS NULL OR bic_swift ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  bank_name TEXT CHECK (bank_name IS NULL OR char_length(bank_name) <= 150),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.tenant_bank_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_bank_details FROM PUBLIC, anon, authenticated;

ALTER TABLE public.franchisee_intake_submissions
  ALTER COLUMN trade_name DROP NOT NULL,
  ALTER COLUMN company_name DROP NOT NULL,
  ADD COLUMN contact_email TEXT CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  ADD COLUMN tax_id TEXT CHECK (tax_id IS NULL OR char_length(tax_id) <= 50),
  ADD COLUMN account_holder_name TEXT CHECK (account_holder_name IS NULL OR char_length(account_holder_name) <= 150),
  ADD COLUMN iban TEXT CHECK (iban IS NULL OR iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  ADD COLUMN bic_swift TEXT CHECK (bic_swift IS NULL OR bic_swift ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$');

ALTER TABLE public.franchisee_signup_requests
  ADD COLUMN tax_id TEXT CHECK (tax_id IS NULL OR char_length(tax_id) <= 50),
  ADD COLUMN account_holder_name TEXT CHECK (account_holder_name IS NULL OR char_length(account_holder_name) <= 150),
  ADD COLUMN iban TEXT CHECK (iban IS NULL OR iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  ADD COLUMN bic_swift TEXT CHECK (bic_swift IS NULL OR bic_swift ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$');

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_company_name_length CHECK (company_name IS NULL OR char_length(company_name) <= 150) NOT VALID,
  ADD CONSTRAINT tenants_tax_id_length CHECK (tax_id IS NULL OR char_length(tax_id) <= 50) NOT VALID,
  ADD CONSTRAINT tenants_contact_email_length CHECK (contact_email IS NULL OR char_length(contact_email) <= 254) NOT VALID,
  ADD CONSTRAINT tenants_contact_phone_length CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40) NOT VALID;
