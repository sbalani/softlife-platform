ALTER TABLE public.franchisee_intake_submissions
  ADD COLUMN representative_title TEXT CHECK (representative_title IS NULL OR char_length(representative_title) BETWEEN 1 AND 150),
  ADD COLUMN registered_address TEXT CHECK (registered_address IS NULL OR char_length(registered_address) BETWEEN 1 AND 500),
  ADD COLUMN installation_address TEXT CHECK (installation_address IS NULL OR char_length(installation_address) BETWEEN 1 AND 500),
  ADD COLUMN modality TEXT CHECK (modality IS NULL OR modality IN ('A', 'B')),
  ADD COLUMN share_percent SMALLINT CHECK (share_percent IS NULL OR share_percent IN (18, 26)),
  ADD COLUMN accepted_at TIMESTAMPTZ,
  ADD COLUMN contract_version TEXT,
  ADD COLUMN contract_template_hash TEXT,
  ADD COLUMN canonical_source JSONB,
  ADD COLUMN canonical_source_sha256 TEXT,
  ADD COLUMN pdf_storage_path TEXT,
  ADD COLUMN pdf_sha256 TEXT,
  ADD COLUMN download_token_sha256 TEXT,
  ADD COLUMN ip_audit_hash TEXT,
  ADD COLUMN user_agent TEXT CHECK (user_agent IS NULL OR char_length(user_agent) BETWEEN 1 AND 500);

ALTER TABLE public.franchisee_intake_submissions
  ADD CONSTRAINT franchisee_intake_modality_share_check CHECK (
    modality IS NULL OR (modality = 'A' AND share_percent = 26) OR (modality = 'B' AND share_percent = 18)
  ),
  ADD CONSTRAINT franchisee_intake_accepted_evidence_complete CHECK (
    accepted_at IS NULL OR (
      representative_title IS NOT NULL AND registered_address IS NOT NULL AND installation_address IS NOT NULL
      AND modality IS NOT NULL AND share_percent IS NOT NULL AND contract_version IS NOT NULL
       AND contract_template_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(canonical_source) = 'object'
      AND canonical_source_sha256 ~ '^[a-f0-9]{64}$' AND pdf_storage_path IS NOT NULL
      AND pdf_sha256 ~ '^[a-f0-9]{64}$' AND download_token_sha256 ~ '^[a-f0-9]{64}$'
       AND ip_audit_hash ~ '^[a-f0-9]{64}$' AND user_agent IS NOT NULL
       AND company_name IS NOT NULL AND contact_email IS NOT NULL
      AND tax_id IS NOT NULL AND account_holder_name IS NOT NULL AND iban IS NOT NULL
    )
  );

CREATE INDEX franchisee_intake_ip_rate_limit_idx
  ON public.franchisee_intake_submissions (ip_audit_hash, accepted_at DESC)
  WHERE accepted_at IS NOT NULL;

CREATE INDEX franchisee_intake_email_rate_limit_idx
  ON public.franchisee_intake_submissions (contact_email, accepted_at DESC)
  WHERE accepted_at IS NOT NULL;

CREATE UNIQUE INDEX franchisee_intake_pdf_storage_path_idx
  ON public.franchisee_intake_submissions (pdf_storage_path)
  WHERE pdf_storage_path IS NOT NULL;

CREATE UNIQUE INDEX franchisee_intake_download_token_idx
  ON public.franchisee_intake_submissions (download_token_sha256)
  WHERE download_token_sha256 IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_franchisee_contract_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'accepted franchisee contract rows cannot be deleted';
  END IF;
   IF TG_OP = 'UPDATE' AND OLD.accepted_at IS NOT NULL AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.trade_name IS DISTINCT FROM OLD.trade_name
    OR NEW.company_name IS DISTINCT FROM OLD.company_name
    OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
    OR NEW.contact_email IS DISTINCT FROM OLD.contact_email
    OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
    OR NEW.tax_id IS DISTINCT FROM OLD.tax_id
    OR NEW.account_holder_name IS DISTINCT FROM OLD.account_holder_name
    OR NEW.iban IS DISTINCT FROM OLD.iban
    OR NEW.bic_swift IS DISTINCT FROM OLD.bic_swift
    OR NEW.representative_title IS DISTINCT FROM OLD.representative_title
    OR NEW.registered_address IS DISTINCT FROM OLD.registered_address
    OR NEW.installation_address IS DISTINCT FROM OLD.installation_address
    OR NEW.modality IS DISTINCT FROM OLD.modality
    OR NEW.share_percent IS DISTINCT FROM OLD.share_percent
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
    OR NEW.contract_template_hash IS DISTINCT FROM OLD.contract_template_hash
    OR NEW.canonical_source IS DISTINCT FROM OLD.canonical_source
    OR NEW.canonical_source_sha256 IS DISTINCT FROM OLD.canonical_source_sha256
    OR NEW.pdf_storage_path IS DISTINCT FROM OLD.pdf_storage_path
    OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
    OR NEW.download_token_sha256 IS DISTINCT FROM OLD.download_token_sha256
    OR NEW.ip_audit_hash IS DISTINCT FROM OLD.ip_audit_hash
    OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'accepted franchisee contract evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_franchisee_contract_evidence
BEFORE UPDATE OR DELETE ON public.franchisee_intake_submissions
FOR EACH ROW EXECUTE FUNCTION public.protect_franchisee_contract_evidence();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('onboarding-contract-evidence', 'onboarding-contract-evidence', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
