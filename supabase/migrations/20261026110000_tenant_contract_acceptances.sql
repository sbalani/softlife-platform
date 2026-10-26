CREATE TABLE public.franchisee_contract_acceptances (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ NOT NULL,
  contract_version TEXT NOT NULL CHECK (contract_version = 'SL-GESTOR-2026-10-26-v3'),
  contract_template_hash TEXT NOT NULL CHECK (contract_template_hash = '1bcedd5dfba2b85600dae517477171800ebab54b6626677f6cf3a3beefc4e8b5'),
  canonical_source JSONB NOT NULL CHECK (jsonb_typeof(canonical_source) = 'object'),
  canonical_source_sha256 TEXT NOT NULL CHECK (canonical_source_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_storage_path TEXT NOT NULL UNIQUE,
  pdf_sha256 TEXT NOT NULL CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  ip_audit_hash TEXT NOT NULL CHECK (ip_audit_hash ~ '^[a-f0-9]{64}$'),
  user_agent TEXT NOT NULL CHECK (char_length(user_agent) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contract_version),
  CHECK ((canonical_source #>> '{schemaVersion}') = '1'),
  CHECK ((canonical_source #>> '{identity,tenantId}') IS NOT DISTINCT FROM tenant_id::text),
  CHECK ((canonical_source #>> '{identity,userId}') IS NOT DISTINCT FROM profile_id::text),
  CHECK ((canonical_source #>> '{contract,version}') IS NOT DISTINCT FROM contract_version),
  CHECK ((canonical_source #>> '{contract,templateHash}') IS NOT DISTINCT FROM contract_template_hash),
  CHECK ((canonical_source #>> '{contract,bindingLanguage}') = 'es'),
  CHECK ((canonical_source #>> '{acceptanceId}') IS NOT DISTINCT FROM id::text),
  CHECK ((canonical_source #>> '{acceptedAt}') IS NOT NULL AND (canonical_source #>> '{acceptedAt}')::timestamptz = accepted_at)
);

CREATE INDEX franchisee_contract_acceptances_profile_idx
  ON public.franchisee_contract_acceptances (profile_id, accepted_at DESC);

CREATE FUNCTION public.validate_franchisee_contract_acceptance_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.profile_id AND tenant_id = NEW.tenant_id AND role = 'franchisee'
  ) THEN
    RAISE EXCEPTION 'Contract acceptance profile must belong to the franchisee tenant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_franchisee_contract_acceptance_actor
BEFORE INSERT ON public.franchisee_contract_acceptances
FOR EACH ROW EXECUTE FUNCTION public.validate_franchisee_contract_acceptance_actor();

CREATE FUNCTION public.protect_franchisee_contract_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Franchisee contract acceptances are immutable';
END;
$$;

CREATE TRIGGER protect_franchisee_contract_acceptance
BEFORE UPDATE OR DELETE ON public.franchisee_contract_acceptances
FOR EACH ROW EXECUTE FUNCTION public.protect_franchisee_contract_acceptance();

ALTER TABLE public.franchisee_contract_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.franchisee_contract_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.franchisee_contract_acceptances TO authenticated;

CREATE POLICY franchisee_contract_acceptances_read
ON public.franchisee_contract_acceptances
FOR SELECT
TO authenticated
USING (tenant_id = public.current_tenant_id() OR public.is_current_admin());

ALTER TABLE public.franchisee_payout_settlements
  ADD COLUMN contract_acceptance_id UUID
  REFERENCES public.franchisee_contract_acceptances(id) ON DELETE RESTRICT;
