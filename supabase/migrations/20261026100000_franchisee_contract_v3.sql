ALTER TABLE public.franchisee_intake_submissions
  DROP CONSTRAINT franchisee_intake_accepted_evidence_complete,
  ADD CONSTRAINT franchisee_intake_accepted_evidence_complete CHECK (
    accepted_at IS NULL OR (
      representative_title IS NOT NULL AND registered_address IS NOT NULL AND installation_address IS NOT NULL
      AND contract_version IS NOT NULL
      AND contract_template_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(canonical_source) = 'object'
      AND canonical_source_sha256 ~ '^[a-f0-9]{64}$' AND pdf_storage_path IS NOT NULL
      AND pdf_sha256 ~ '^[a-f0-9]{64}$' AND download_token_sha256 ~ '^[a-f0-9]{64}$'
      AND ip_audit_hash ~ '^[a-f0-9]{64}$' AND user_agent IS NOT NULL
      AND company_name IS NOT NULL AND contact_email IS NOT NULL AND tax_id IS NOT NULL
      AND (
        (
          contract_version = 'SL-GESTOR-2026-09-29-v1'
          AND modality IS NOT NULL AND share_percent IS NOT NULL
          AND bank_details_deferred = false AND account_holder_name IS NOT NULL AND iban IS NOT NULL
        )
        OR (
          contract_version IN ('SL-GESTOR-2026-09-29-v2', 'SL-GESTOR-2026-10-26-v3')
          AND modality IS NULL AND share_percent IS NULL
          AND (
            (bank_details_deferred = true AND account_holder_name IS NULL AND iban IS NULL AND bic_swift IS NULL)
            OR (bank_details_deferred = false AND account_holder_name IS NOT NULL AND account_holder_name <> '' AND iban IS NOT NULL)
          )
        )
      )
    )
  );
