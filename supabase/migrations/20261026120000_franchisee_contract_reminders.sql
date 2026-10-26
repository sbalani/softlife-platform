CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.franchisee_contract_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  contract_version TEXT NOT NULL CHECK (contract_version = 'SL-GESTOR-2026-10-26-v3'),
  due_date DATE NOT NULL CHECK (due_date = DATE '2026-11-14'),
  recipient_email TEXT,
  recipient_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  claim_token UUID,
  lease_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_id TEXT,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  skipped_at TIMESTAMPTZ,
  error TEXT CHECK (error IS NULL OR char_length(error) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contract_version),
  CHECK (recipient_email IS NULL OR char_length(recipient_email) BETWEEN 3 AND 254),
  CHECK (char_length(recipient_name) BETWEEN 1 AND 150),
  CHECK (status <> 'sending' OR (claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (status <> 'sent' OR (provider_id IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL),
  CHECK (status <> 'skipped' OR skipped_at IS NOT NULL)
);

CREATE UNIQUE INDEX franchisee_contract_reminders_provider_idx
  ON public.franchisee_contract_reminders (provider_id)
  WHERE provider_id IS NOT NULL;

CREATE INDEX franchisee_contract_reminders_claim_idx
  ON public.franchisee_contract_reminders (status, lease_until, created_at)
  WHERE status IN ('pending', 'sending', 'failed');

ALTER TABLE public.franchisee_contract_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.franchisee_contract_reminders FROM PUBLIC, anon, authenticated;

INSERT INTO public.franchisee_contract_reminders (
  tenant_id, contract_version, due_date, recipient_email, recipient_name,
  status, skipped_at, error
)
SELECT
  tenant.id,
  'SL-GESTOR-2026-10-26-v3',
  DATE '2026-11-14',
  recipient.email,
  left(recipient.name, 150),
  CASE WHEN acceptance.accepted OR recipient.email IS NULL THEN 'skipped' ELSE 'pending' END,
  CASE WHEN acceptance.accepted OR recipient.email IS NULL THEN now() END,
  CASE
    WHEN acceptance.accepted THEN 'El contrato vigente ya estaba aceptado al crear la campaña'
    WHEN recipient.email IS NULL THEN 'No hay una dirección de correo válida disponible para el recordatorio'
  END
FROM public.tenants tenant
LEFT JOIN LATERAL (
  SELECT contact.email, contact.full_name
  FROM public.tenant_contacts contact
  WHERE contact.tenant_id = tenant.id
    AND contact.is_primary
    AND char_length(NULLIF(btrim(contact.email), '')) BETWEEN 3 AND 254
  ORDER BY contact.created_at, contact.id
  LIMIT 1
) primary_contact ON true
LEFT JOIN LATERAL (
  SELECT NULLIF(btrim(profile.email), '') AS email, NULLIF(btrim(profile.full_name), '') AS full_name
  FROM public.profiles profile
  WHERE profile.tenant_id = tenant.id
    AND profile.role = 'franchisee'
    AND char_length(NULLIF(btrim(profile.email), '')) BETWEEN 3 AND 254
  ORDER BY profile.created_at, profile.id
  LIMIT 1
) franchisee_profile ON true
CROSS JOIN LATERAL (
  SELECT
    lower(COALESCE(
      CASE WHEN char_length(NULLIF(btrim(tenant.contact_email), '')) BETWEEN 3 AND 254
        THEN NULLIF(btrim(tenant.contact_email), '')
      END,
      CASE WHEN char_length(NULLIF(btrim(primary_contact.email), '')) BETWEEN 3 AND 254
        THEN NULLIF(btrim(primary_contact.email), '')
      END,
      CASE WHEN char_length(franchisee_profile.email) BETWEEN 3 AND 254
        THEN franchisee_profile.email
      END
    )) AS email,
    COALESCE(
      CASE WHEN char_length(NULLIF(btrim(tenant.contact_email), '')) BETWEEN 3 AND 254
        THEN COALESCE(
          NULLIF(btrim(tenant.company_name), ''),
          NULLIF(btrim(tenant.name), ''),
          'Franquiciado SoftLife'
        )
      END,
      CASE WHEN char_length(NULLIF(btrim(primary_contact.email), '')) BETWEEN 3 AND 254
        THEN NULLIF(btrim(primary_contact.full_name), '')
      END,
      franchisee_profile.full_name,
      NULLIF(btrim(tenant.company_name), ''),
      NULLIF(btrim(tenant.name), ''),
      'Franquiciado SoftLife'
    ) AS name
) recipient
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1
    FROM public.franchisee_contract_acceptances contract_acceptance
    WHERE contract_acceptance.tenant_id = tenant.id
      AND contract_acceptance.contract_version = 'SL-GESTOR-2026-10-26-v3'
  ) AS accepted
) acceptance
WHERE tenant.kind = 'franchisee';

CREATE FUNCTION public.claim_franchisee_contract_reminders(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  reminder_id UUID,
  tenant_id UUID,
  contract_version TEXT,
  due_date DATE,
  recipient_email TEXT,
  recipient_name TEXT,
  claim_token UUID,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.franchisee_contract_reminders reminder
  SET status = 'skipped', skipped_at = now(), lease_until = NULL,
      error = 'El contrato vigente fue aceptado antes del envío', updated_at = now()
  WHERE (reminder.status IN ('pending', 'failed')
      OR (reminder.status = 'sending' AND reminder.lease_until < now()))
    AND EXISTS (
      SELECT 1
      FROM public.franchisee_contract_acceptances acceptance
      WHERE acceptance.tenant_id = reminder.tenant_id
        AND acceptance.contract_version = reminder.contract_version
    );

  UPDATE public.franchisee_contract_reminders reminder
  SET status = 'skipped', skipped_at = now(), lease_until = NULL,
      error = 'La fecha límite de la campaña ya ha pasado', updated_at = now()
  WHERE (reminder.status IN ('pending', 'failed')
      OR (reminder.status = 'sending' AND reminder.lease_until < now()))
    AND current_date > reminder.due_date;

  RETURN QUERY
  WITH candidates AS (
    SELECT reminder.id
    FROM public.franchisee_contract_reminders reminder
    WHERE (reminder.status IN ('pending', 'failed')
        OR (reminder.status = 'sending' AND reminder.lease_until < now()))
      AND reminder.recipient_email IS NOT NULL
      AND current_date <= reminder.due_date
      AND NOT EXISTS (
        SELECT 1
        FROM public.franchisee_contract_acceptances acceptance
        WHERE acceptance.tenant_id = reminder.tenant_id
          AND acceptance.contract_version = reminder.contract_version
      )
    ORDER BY reminder.created_at, reminder.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ), claimed AS (
    UPDATE public.franchisee_contract_reminders reminder
    SET status = 'sending', claim_token = gen_random_uuid(),
        lease_until = now() + INTERVAL '10 minutes',
        attempt_count = reminder.attempt_count + 1,
        error = NULL, updated_at = now()
    FROM candidates
    WHERE reminder.id = candidates.id
    RETURNING reminder.*
  )
  SELECT claimed.id, claimed.tenant_id, claimed.contract_version, claimed.due_date,
         claimed.recipient_email, claimed.recipient_name, claimed.claim_token,
         claimed.attempt_count
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

CREATE FUNCTION public.complete_franchisee_contract_reminder(
  p_reminder_id UUID,
  p_claim_token UUID,
  p_provider_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE reminder public.franchisee_contract_reminders%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_provider_id), '') IS NULL THEN
    RAISE EXCEPTION 'A provider message ID is required';
  END IF;

  SELECT * INTO reminder
  FROM public.franchisee_contract_reminders
  WHERE id = p_reminder_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Contract reminder not found'; END IF;
  IF reminder.status = 'sent'
      AND reminder.claim_token = p_claim_token
      AND reminder.provider_id = p_provider_id THEN
    RETURN true;
  END IF;
  IF reminder.status <> 'sending' OR reminder.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'Contract reminder lease is stale';
  END IF;

  UPDATE public.franchisee_contract_reminders
  SET status = 'sent', provider_id = p_provider_id, sent_at = now(),
      lease_until = NULL, error = NULL, updated_at = now()
  WHERE id = p_reminder_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.fail_franchisee_contract_reminder(
  p_reminder_id UUID,
  p_claim_token UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE reminder public.franchisee_contract_reminders%ROWTYPE;
BEGIN
  SELECT * INTO reminder
  FROM public.franchisee_contract_reminders
  WHERE id = p_reminder_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Contract reminder not found'; END IF;
  IF reminder.status = 'failed' AND reminder.claim_token = p_claim_token THEN RETURN true; END IF;
  IF reminder.status <> 'sending' OR reminder.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'Contract reminder lease is stale';
  END IF;

  UPDATE public.franchisee_contract_reminders
  SET status = 'failed', failed_at = now(), lease_until = NULL,
      error = left(COALESCE(NULLIF(btrim(p_error), ''), 'Resend no pudo entregar el recordatorio'), 2000),
      updated_at = now()
  WHERE id = p_reminder_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.get_franchisee_contract_reminder_counts()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'sending', count(*) FILTER (WHERE status = 'sending'),
    'sent', count(*) FILTER (WHERE status = 'sent'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'skipped', count(*) FILTER (WHERE status = 'skipped')
  )
  FROM public.franchisee_contract_reminders
$$;

CREATE FUNCTION public.verify_franchisee_contract_reminder_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT length(COALESCE(p_token, '')) >= 32
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'softlife_franchisee_contract_reminder_token'
        AND decrypted_secret = p_token
    )
$$;

CREATE FUNCTION public.configure_franchisee_contract_reminder_schedule(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, net
AS $$
DECLARE existing_job RECORD; generated_token TEXT; current_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/franchisee-contract-reminders$' THEN
    RAISE EXCEPTION 'Invalid franchisee contract reminder function URL';
  END IF;

  SELECT decrypted_secret INTO current_token
  FROM vault.decrypted_secrets
  WHERE name = 'softlife_franchisee_contract_reminder_token';
  IF current_token IS NULL THEN
    generated_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(
      generated_token,
      'softlife_franchisee_contract_reminder_token',
      'Authenticates franchisee contract reminder requests'
    );
  END IF;

  DELETE FROM vault.secrets WHERE name = 'softlife_franchisee_contract_reminder_function_url';
  PERFORM vault.create_secret(
    p_function_url,
    'softlife_franchisee_contract_reminder_function_url',
    'Supabase franchisee contract reminder function URL'
  );

  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'softlife-franchisee-contract-reminders-daily'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'softlife-franchisee-contract-reminders-daily',
    '0 8 * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_franchisee_contract_reminder_function_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_franchisee_contract_reminder_token')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $job$
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_franchisee_contract_reminders(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_franchisee_contract_reminder(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_franchisee_contract_reminder(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_franchisee_contract_reminder_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_franchisee_contract_reminder_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_franchisee_contract_reminder_schedule(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_franchisee_contract_reminders(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_franchisee_contract_reminder(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_franchisee_contract_reminder(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_franchisee_contract_reminder_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_franchisee_contract_reminder_token(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.configure_franchisee_contract_reminder_schedule(TEXT) TO service_role;

COMMENT ON FUNCTION public.configure_franchisee_contract_reminder_schedule(TEXT) IS
  'Run only after RESEND_API_KEY is configured and the franchisee-contract-reminders function is deployed. This migration intentionally does not activate the schedule.';
