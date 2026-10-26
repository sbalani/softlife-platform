CREATE TABLE public.user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL UNIQUE CHECK (char_length(source_key) BETWEEN 1 AND 300),
  source_type TEXT NOT NULL CHECK (source_type = 'payout_paid'),
  source_id UUID NOT NULL REFERENCES public.franchisee_payout_settlements(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  href TEXT NOT NULL CHECK (href = '/payouts'),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  push_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (push_status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  push_claim_token UUID,
  push_lease_until TIMESTAMPTZ,
  push_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (push_attempt_count >= 0),
  push_provider_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(push_provider_ids) = 'array'),
  push_sent_at TIMESTAMPTZ,
  push_failed_at TIMESTAMPTZ,
  push_skipped_at TIMESTAMPTZ,
  push_error TEXT CHECK (push_error IS NULL OR char_length(push_error) <= 2000),
  CHECK (push_status <> 'sending' OR (push_claim_token IS NOT NULL AND push_lease_until IS NOT NULL)),
  CHECK (push_status <> 'sent' OR push_sent_at IS NOT NULL),
  CHECK (push_status <> 'failed' OR push_failed_at IS NOT NULL),
  CHECK (push_status <> 'skipped' OR push_skipped_at IS NOT NULL)
);

CREATE INDEX user_notifications_user_created_idx
  ON public.user_notifications (user_id, created_at DESC);
CREATE INDEX user_notifications_unread_idx
  ON public.user_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX user_notifications_push_claim_idx
  ON public.user_notifications (push_status, push_lease_until, created_at)
  WHERE push_status IN ('pending', 'sending', 'failed');

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_notifications TO authenticated;

CREATE POLICY user_notifications_read
ON public.user_notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_current_admin());

CREATE TABLE public.payout_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL UNIQUE REFERENCES public.franchisee_payout_settlements(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  recipient_email TEXT,
  recipient_name TEXT NOT NULL CHECK (char_length(recipient_name) BETWEEN 1 AND 150),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  period_month DATE NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  payment_reference TEXT NOT NULL CHECK (char_length(btrim(payment_reference)) BETWEEN 1 AND 200),
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
  CHECK (recipient_email IS NULL OR char_length(recipient_email) BETWEEN 3 AND 254),
  CHECK (status <> 'sending' OR (claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (status <> 'sent' OR (provider_id IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL),
  CHECK (status <> 'skipped' OR skipped_at IS NOT NULL)
);

CREATE UNIQUE INDEX payout_email_outbox_provider_idx
  ON public.payout_email_outbox (provider_id)
  WHERE provider_id IS NOT NULL;
CREATE INDEX payout_email_outbox_claim_idx
  ON public.payout_email_outbox (status, lease_until, created_at)
  WHERE status IN ('pending', 'sending', 'failed');

ALTER TABLE public.payout_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_email_outbox FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.enqueue_paid_payout_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month_label TEXT;
  v_amount_label TEXT;
  v_title TEXT;
  v_body TEXT;
  v_recipient_email TEXT;
  v_recipient_name TEXT;
BEGIN
  IF NEW.status <> 'paid'
      OR (TG_OP = 'UPDATE' AND OLD.status = 'paid') THEN
    RETURN NEW;
  END IF;

  v_month_label := CASE EXTRACT(MONTH FROM NEW.period_month)::INTEGER
    WHEN 1 THEN 'enero' WHEN 2 THEN 'febrero' WHEN 3 THEN 'marzo'
    WHEN 4 THEN 'abril' WHEN 5 THEN 'mayo' WHEN 6 THEN 'junio'
    WHEN 7 THEN 'julio' WHEN 8 THEN 'agosto' WHEN 9 THEN 'septiembre'
    WHEN 10 THEN 'octubre' WHEN 11 THEN 'noviembre' ELSE 'diciembre'
  END || ' de ' || EXTRACT(YEAR FROM NEW.period_month)::INTEGER;
  v_amount_label := replace(to_char(NEW.paid_total_cents::numeric / 100, 'FM999999990D00'), '.', ',') || ' €';
  v_title := 'Pago recibido: ' || v_month_label;
  v_body := 'Hemos realizado tu pago de ' || v_amount_label ||
    ' correspondiente a ' || v_month_label || '. Referencia: ' || NEW.payment_reference || '.';

  INSERT INTO public.user_notifications (
    user_id, source_key, source_type, source_id, title, body, href, data
  )
  SELECT
    profile.id,
    'payout_paid:' || NEW.id::text || ':' || profile.id::text,
    'payout_paid',
    NEW.id,
    v_title,
    v_body,
    '/payouts',
    jsonb_build_object(
      'settlementId', NEW.id,
      'tenantId', NEW.tenant_id,
      'amountCents', NEW.paid_total_cents,
      'periodMonth', to_char(NEW.period_month, 'YYYY-MM'),
      'paymentReference', NEW.payment_reference
    )
  FROM public.profiles profile
  JOIN auth.users auth_user ON auth_user.id = profile.id
  WHERE profile.tenant_id = NEW.tenant_id
    AND profile.role = 'franchisee'
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until < now())
  ON CONFLICT (source_key) DO NOTHING;

  SELECT
    lower(COALESCE(
      CASE WHEN char_length(NULLIF(btrim(tenant.contact_email), '')) BETWEEN 3 AND 254
        THEN NULLIF(btrim(tenant.contact_email), '') END,
      CASE WHEN char_length(NULLIF(btrim(primary_contact.email), '')) BETWEEN 3 AND 254
        THEN NULLIF(btrim(primary_contact.email), '') END,
      CASE WHEN char_length(NULLIF(btrim(franchisee_profile.email), '')) BETWEEN 3 AND 254
        THEN NULLIF(btrim(franchisee_profile.email), '') END
    )),
    left(COALESCE(
      CASE WHEN char_length(NULLIF(btrim(tenant.contact_email), '')) BETWEEN 3 AND 254
        THEN COALESCE(NULLIF(btrim(tenant.company_name), ''), NULLIF(btrim(tenant.name), '')) END,
      CASE WHEN char_length(NULLIF(btrim(primary_contact.email), '')) BETWEEN 3 AND 254
        THEN NULLIF(btrim(primary_contact.full_name), '') END,
      NULLIF(btrim(franchisee_profile.full_name), ''),
      NULLIF(btrim(tenant.company_name), ''),
      NULLIF(btrim(tenant.name), ''),
      'Franquiciado SoftLife'
    ), 150)
  INTO v_recipient_email, v_recipient_name
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
    SELECT profile.email, profile.full_name
    FROM public.profiles profile
    JOIN auth.users auth_user ON auth_user.id = profile.id
    WHERE profile.tenant_id = tenant.id
      AND profile.role = 'franchisee'
      AND char_length(NULLIF(btrim(profile.email), '')) BETWEEN 3 AND 254
      AND auth_user.deleted_at IS NULL
      AND (auth_user.banned_until IS NULL OR auth_user.banned_until < now())
    ORDER BY profile.created_at, profile.id
    LIMIT 1
  ) franchisee_profile ON true
  WHERE tenant.id = NEW.tenant_id;

  INSERT INTO public.payout_email_outbox (
    settlement_id, tenant_id, recipient_email, recipient_name,
    amount_cents, period_month, payment_reference, status, skipped_at, error
  ) VALUES (
    NEW.id, NEW.tenant_id, v_recipient_email, v_recipient_name,
    NEW.paid_total_cents, NEW.period_month, NEW.payment_reference,
    CASE WHEN v_recipient_email IS NULL THEN 'skipped' ELSE 'pending' END,
    CASE WHEN v_recipient_email IS NULL THEN now() END,
    CASE WHEN v_recipient_email IS NULL THEN 'No hay una dirección de correo disponible para el pago' END
  )
  ON CONFLICT (settlement_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enqueue_paid_payout_notifications
AFTER INSERT OR UPDATE OF status ON public.franchisee_payout_settlements
FOR EACH ROW
WHEN (NEW.status = 'paid')
EXECUTE FUNCTION public.enqueue_paid_payout_notifications();

CREATE FUNCTION public.claim_payout_emails(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  outbox_id UUID,
  settlement_id UUID,
  recipient_email TEXT,
  recipient_name TEXT,
  amount_cents BIGINT,
  period_month DATE,
  payment_reference TEXT,
  claim_token UUID,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT email.id
    FROM public.payout_email_outbox email
    WHERE email.recipient_email IS NOT NULL
      AND (email.status IN ('pending', 'failed')
        OR (email.status = 'sending' AND email.lease_until < now()))
    ORDER BY email.created_at, email.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  ), claimed AS (
    UPDATE public.payout_email_outbox email
    SET status = 'sending', claim_token = gen_random_uuid(),
        lease_until = now() + INTERVAL '10 minutes',
        attempt_count = email.attempt_count + 1,
        failed_at = NULL, error = NULL, updated_at = now()
    FROM candidates
    WHERE email.id = candidates.id
    RETURNING email.*
  )
  SELECT claimed.id, claimed.settlement_id, claimed.recipient_email,
         claimed.recipient_name, claimed.amount_cents, claimed.period_month,
         claimed.payment_reference, claimed.claim_token, claimed.attempt_count
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

CREATE FUNCTION public.complete_payout_email(
  p_outbox_id UUID,
  p_claim_token UUID,
  p_provider_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE email public.payout_email_outbox%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_provider_id), '') IS NULL THEN RAISE EXCEPTION 'Provider ID is required'; END IF;
  SELECT * INTO email FROM public.payout_email_outbox WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout email not found'; END IF;
  IF email.status = 'sent' AND email.claim_token = p_claim_token AND email.provider_id = p_provider_id THEN RETURN true; END IF;
  IF email.status <> 'sending' OR email.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'Payout email lease is stale'; END IF;
  UPDATE public.payout_email_outbox
  SET status = 'sent', provider_id = p_provider_id, sent_at = now(),
      failed_at = NULL, lease_until = NULL, error = NULL, updated_at = now()
  WHERE id = p_outbox_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.fail_payout_email(
  p_outbox_id UUID,
  p_claim_token UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE email public.payout_email_outbox%ROWTYPE;
BEGIN
  SELECT * INTO email FROM public.payout_email_outbox WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout email not found'; END IF;
  IF email.status = 'failed' AND email.claim_token = p_claim_token THEN RETURN true; END IF;
  IF email.status <> 'sending' OR email.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'Payout email lease is stale'; END IF;
  UPDATE public.payout_email_outbox
  SET status = 'failed', failed_at = now(), lease_until = NULL,
      error = left(COALESCE(NULLIF(btrim(p_error), ''), 'No se pudo enviar el correo del pago'), 2000),
      updated_at = now()
  WHERE id = p_outbox_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.claim_payout_notification_pushes(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  notification_id UUID,
  title TEXT,
  body TEXT,
  href TEXT,
  data JSONB,
  push_tokens JSONB,
  claim_token UUID,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.user_notifications notification
  SET push_status = 'skipped', push_skipped_at = now(),
      push_claim_token = NULL, push_lease_until = NULL,
      push_error = 'No hay dispositivos registrados para este usuario'
  WHERE (notification.push_status IN ('pending', 'failed')
      OR (notification.push_status = 'sending' AND notification.push_lease_until < now()))
    AND NOT EXISTS (
      SELECT 1 FROM public.mobile_push_tokens token WHERE token.user_id = notification.user_id
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT notification.id
    FROM public.user_notifications notification
    WHERE (notification.push_status IN ('pending', 'failed')
        OR (notification.push_status = 'sending' AND notification.push_lease_until < now()))
      AND EXISTS (
        SELECT 1 FROM public.mobile_push_tokens token WHERE token.user_id = notification.user_id
      )
    ORDER BY notification.created_at, notification.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  ), claimed AS (
    UPDATE public.user_notifications notification
    SET push_status = 'sending', push_claim_token = gen_random_uuid(),
        push_lease_until = now() + INTERVAL '10 minutes',
        push_attempt_count = notification.push_attempt_count + 1,
        push_failed_at = NULL, push_skipped_at = NULL, push_error = NULL
    FROM candidates
    WHERE notification.id = candidates.id
    RETURNING notification.*
  )
  SELECT claimed.id, claimed.title, claimed.body, claimed.href, claimed.data,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', token.id, 'token', token.expo_push_token) ORDER BY token.created_at, token.id)
           FROM public.mobile_push_tokens token
           WHERE token.user_id = claimed.user_id
         ), '[]'::jsonb),
         claimed.push_claim_token, claimed.push_attempt_count
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

CREATE FUNCTION public.complete_payout_notification_push(
  p_notification_id UUID,
  p_claim_token UUID,
  p_provider_ids JSONB DEFAULT '[]'::jsonb,
  p_no_device BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE notification public.user_notifications%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_provider_ids) <> 'array' THEN RAISE EXCEPTION 'Provider IDs must be an array'; END IF;
  SELECT * INTO notification FROM public.user_notifications WHERE id = p_notification_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found'; END IF;
  IF notification.push_status IN ('sent', 'skipped') AND notification.push_claim_token = p_claim_token THEN RETURN true; END IF;
  IF notification.push_status <> 'sending' OR notification.push_claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'Notification push lease is stale'; END IF;
  UPDATE public.user_notifications
  SET push_status = CASE WHEN p_no_device THEN 'skipped' ELSE 'sent' END,
      push_provider_ids = p_provider_ids,
      push_sent_at = CASE WHEN p_no_device THEN NULL ELSE now() END,
      push_failed_at = NULL,
      push_skipped_at = CASE WHEN p_no_device THEN now() ELSE NULL END,
      push_lease_until = NULL,
      push_error = CASE WHEN p_no_device THEN 'No quedan dispositivos registrados para este usuario' ELSE NULL END
  WHERE id = p_notification_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.fail_payout_notification_push(
  p_notification_id UUID,
  p_claim_token UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE notification public.user_notifications%ROWTYPE;
BEGIN
  SELECT * INTO notification FROM public.user_notifications WHERE id = p_notification_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found'; END IF;
  IF notification.push_status = 'failed' AND notification.push_claim_token = p_claim_token THEN RETURN true; END IF;
  IF notification.push_status <> 'sending' OR notification.push_claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'Notification push lease is stale'; END IF;
  UPDATE public.user_notifications
  SET push_status = 'failed', push_failed_at = now(), push_lease_until = NULL,
      push_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'Expo no pudo entregar la notificación'), 2000)
  WHERE id = p_notification_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.verify_payout_notifications_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT length(COALESCE(p_token, '')) >= 32
    AND EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'softlife_payout_notifications_token'
        AND decrypted_secret = p_token
    )
$$;

CREATE FUNCTION public.configure_payout_notifications_schedule(p_function_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, net
AS $$
DECLARE existing_job RECORD; generated_token TEXT; current_token TEXT;
BEGIN
  IF p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/payout-notifications$' THEN
    RAISE EXCEPTION 'Invalid payout notifications function URL';
  END IF;
  SELECT decrypted_secret INTO current_token
  FROM vault.decrypted_secrets WHERE name = 'softlife_payout_notifications_token';
  IF current_token IS NULL THEN
    generated_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(generated_token, 'softlife_payout_notifications_token', 'Authenticates payout notification delivery');
  END IF;
  DELETE FROM vault.secrets WHERE name = 'softlife_payout_notifications_function_url';
  PERFORM vault.create_secret(p_function_url, 'softlife_payout_notifications_function_url', 'Payout notification Edge Function URL');
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'softlife-payout-notifications'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'softlife-payout-notifications',
    '*/5 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_payout_notifications_function_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'softlife_payout_notifications_token')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $job$
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_paid_payout_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_payout_emails(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_payout_email(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_payout_email(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_payout_notification_pushes(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_payout_notification_push(UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_payout_notification_push(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_payout_notifications_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_payout_notifications_schedule(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_payout_emails(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_payout_email(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_payout_email(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payout_notification_pushes(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_payout_notification_push(UUID, UUID, JSONB, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_payout_notification_push(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_payout_notifications_token(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.configure_payout_notifications_schedule(TEXT) TO service_role;

COMMENT ON FUNCTION public.configure_payout_notifications_schedule(TEXT) IS
  'Run only after RESEND_API_KEY is configured and payout-notifications is deployed. This migration intentionally does not activate cron.';
