ALTER TABLE public.franchisee_intake_submissions
  ADD COLUMN assigned_tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ADD COLUMN assigned_modality TEXT CHECK (assigned_modality IS NULL OR assigned_modality IN ('A', 'B')),
  ADD COLUMN assigned_share_percent SMALLINT CHECK (assigned_share_percent IS NULL OR assigned_share_percent IN (18, 26)),
  ADD COLUMN assigned_at TIMESTAMPTZ,
  ADD COLUMN assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT franchisee_intake_assignment_complete CHECK (
    (assigned_tenant_id IS NULL AND assigned_modality IS NULL AND assigned_share_percent IS NULL AND assigned_at IS NULL)
    OR (assigned_tenant_id IS NOT NULL AND assigned_at IS NOT NULL
      AND ((assigned_modality = 'A' AND assigned_share_percent = 26)
        OR (assigned_modality = 'B' AND assigned_share_percent = 18)))
  );

ALTER TABLE public.tenants
  ADD COLUMN source_intake_submission_id UUID REFERENCES public.franchisee_intake_submissions(id) ON DELETE RESTRICT,
  ADD COLUMN onboarding_modality TEXT CHECK (onboarding_modality IS NULL OR onboarding_modality IN ('A', 'B')),
  ADD COLUMN onboarding_share_percent SMALLINT CHECK (onboarding_share_percent IS NULL OR onboarding_share_percent IN (18, 26)),
  ADD CONSTRAINT tenants_onboarding_modality_share_check CHECK (
    onboarding_modality IS NULL
    OR (onboarding_modality = 'A' AND onboarding_share_percent = 26)
    OR (onboarding_modality = 'B' AND onboarding_share_percent = 18)
  );

CREATE UNIQUE INDEX tenants_source_intake_submission_idx
  ON public.tenants(source_intake_submission_id)
  WHERE source_intake_submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.convert_franchisee_intake_submission(
  p_submission_id UUID,
  p_modality TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.franchisee_intake_submissions%ROWTYPE;
  v_tenant_id UUID;
  v_share SMALLINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_modality NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'Modality must be A or B';
  END IF;
  v_share := CASE p_modality WHEN 'A' THEN 26 ELSE 18 END;

  SELECT * INTO v_submission
  FROM public.franchisee_intake_submissions
  WHERE id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intake submission not found';
  END IF;
  IF v_submission.status <> 'pending' OR v_submission.assigned_tenant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Intake submission has already been processed';
  END IF;
  IF v_submission.accepted_at IS NULL THEN
    RAISE EXCEPTION 'The onboarding contract has not been accepted';
  END IF;

  INSERT INTO public.tenants(
    name, kind, company_name, tax_id, contact_email, contact_phone,
    address_line_1, source_intake_submission_id,
    onboarding_modality, onboarding_share_percent
  ) VALUES (
    COALESCE(NULLIF(v_submission.trade_name, ''), v_submission.company_name, v_submission.contact_name),
    'franchisee', v_submission.company_name, v_submission.tax_id,
    lower(v_submission.contact_email), v_submission.contact_phone,
    v_submission.registered_address, v_submission.id, p_modality, v_share
  ) RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_contacts(
    tenant_id, full_name, job_title, email, phone, is_primary
  ) VALUES (
    v_tenant_id, v_submission.contact_name, v_submission.representative_title,
    lower(v_submission.contact_email), v_submission.contact_phone, true
  );

  IF v_submission.account_holder_name IS NOT NULL AND v_submission.iban IS NOT NULL THEN
    INSERT INTO public.tenant_bank_details(
      tenant_id, account_holder_name, iban, bic_swift, updated_by
    ) VALUES (
      v_tenant_id, v_submission.account_holder_name, v_submission.iban,
      v_submission.bic_swift, p_actor_id
    );
  END IF;

  UPDATE public.franchisee_intake_submissions
  SET status = 'processed', processed_at = now(), assigned_tenant_id = v_tenant_id,
    assigned_modality = p_modality, assigned_share_percent = v_share,
    assigned_at = now(), assigned_by = p_actor_id
  WHERE id = v_submission.id;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'modality', p_modality,
    'share_percent', v_share
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_franchisee_intake_submission(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_franchisee_intake_submission(UUID, TEXT, UUID) TO service_role;
