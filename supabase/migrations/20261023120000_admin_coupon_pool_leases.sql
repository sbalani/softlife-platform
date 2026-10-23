CREATE TABLE public.admin_coupon_pool_leases (
  huaxin_coupon_id TEXT NOT NULL CHECK (huaxin_coupon_id ~ '^[0-9]+$'),
  coupon_code TEXT NOT NULL CHECK (coupon_code = btrim(coupon_code) AND char_length(coupon_code) BETWEEN 1 AND 200),
  owner_actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pool_id UUID NOT NULL,
  lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
  leased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (huaxin_coupon_id, coupon_code),
  UNIQUE (lease_token),
  CHECK (expires_at > leased_at)
);

CREATE INDEX admin_coupon_pool_leases_pool_expiry_idx
  ON public.admin_coupon_pool_leases (owner_actor_id, pool_id, expires_at);

ALTER TABLE public.admin_coupon_pool_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_coupon_pool_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_coupon_pool_leases TO service_role;

CREATE OR REPLACE FUNCTION public.claim_admin_coupon_pool(
  p_actor_id UUID,
  p_pool_id UUID,
  p_candidates JSONB
)
RETURNS TABLE(
  huaxin_coupon_id TEXT,
  coupon_name TEXT,
  coupon_code TEXT,
  provider_expires_at TIMESTAMPTZ,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  extra_information TEXT,
  metadata_revision BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := statement_timestamp();
  v_needed INTEGER;
BEGIN
  IF p_actor_id IS NULL OR p_pool_id IS NULL OR jsonb_typeof(p_candidates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid coupon pool request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Coupon pool actor must be an admin';
  END IF;

  -- Coupon pools are tiny and admin-only. A global lock makes competing candidate
  -- selections deterministic while the primary key remains the overlap backstop.
  PERFORM pg_advisory_xact_lock(8132284961);

  DELETE FROM public.admin_coupon_pool_leases lease WHERE lease.expires_at <= v_now;

  WITH candidates AS (
    SELECT value->>'huaxin_coupon_id' AS huaxin_coupon_id,
           value->>'coupon_code' AS coupon_code,
           NULLIF(value->>'provider_expires_at', '')::TIMESTAMPTZ AS provider_expires_at,
           (value->>'group_expires_at')::TIMESTAMPTZ AS group_expires_at
    FROM jsonb_array_elements(p_candidates) value
  )
  DELETE FROM public.admin_coupon_pool_leases lease
  WHERE lease.owner_actor_id = p_actor_id
    AND lease.pool_id = p_pool_id
    AND NOT EXISTS (
      SELECT 1 FROM candidates candidate
      WHERE candidate.huaxin_coupon_id = lease.huaxin_coupon_id
        AND candidate.coupon_code = lease.coupon_code
        AND candidate.group_expires_at > v_now
        AND (candidate.provider_expires_at IS NULL OR candidate.provider_expires_at > v_now)
        AND NOT EXISTS (
          SELECT 1 FROM public.coupon_code_metadata metadata
          WHERE metadata.huaxin_coupon_id = candidate.huaxin_coupon_id
            AND metadata.coupon_code = candidate.coupon_code
            AND metadata.distributed
        )
    );

  WITH candidates AS (
    SELECT value->>'huaxin_coupon_id' AS huaxin_coupon_id,
           value->>'coupon_code' AS coupon_code,
           NULLIF(value->>'provider_expires_at', '')::TIMESTAMPTZ AS provider_expires_at,
           (value->>'group_expires_at')::TIMESTAMPTZ AS group_expires_at
    FROM jsonb_array_elements(p_candidates) value
  )
  UPDATE public.admin_coupon_pool_leases lease
  SET expires_at = LEAST(
    lease.expires_at,
    v_now + INTERVAL '24 hours',
    candidate.group_expires_at,
    COALESCE(candidate.provider_expires_at, 'infinity'::TIMESTAMPTZ)
  )
  FROM candidates candidate
  WHERE lease.owner_actor_id = p_actor_id
    AND lease.pool_id = p_pool_id
    AND candidate.huaxin_coupon_id = lease.huaxin_coupon_id
    AND candidate.coupon_code = lease.coupon_code;

  SELECT GREATEST(0, 5 - count(*))::INTEGER INTO v_needed
  FROM public.admin_coupon_pool_leases lease
  WHERE lease.owner_actor_id = p_actor_id AND lease.pool_id = p_pool_id AND lease.expires_at > v_now;

  WITH candidates AS (
    SELECT value->>'huaxin_coupon_id' AS huaxin_coupon_id,
           value->>'coupon_code' AS coupon_code,
           NULLIF(value->>'provider_expires_at', '')::TIMESTAMPTZ AS provider_expires_at,
           (value->>'group_expires_at')::TIMESTAMPTZ AS group_expires_at
    FROM jsonb_array_elements(p_candidates) value
  ), available AS (
    SELECT candidate.*
    FROM candidates candidate
    WHERE candidate.group_expires_at > v_now
      AND (candidate.provider_expires_at IS NULL OR candidate.provider_expires_at > v_now)
      AND NOT EXISTS (
        SELECT 1 FROM public.coupon_code_metadata metadata
        WHERE metadata.huaxin_coupon_id = candidate.huaxin_coupon_id
          AND metadata.coupon_code = candidate.coupon_code
          AND metadata.distributed
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_coupon_pool_leases lease
        WHERE lease.huaxin_coupon_id = candidate.huaxin_coupon_id
          AND lease.coupon_code = candidate.coupon_code
      )
    ORDER BY LEAST(candidate.group_expires_at, COALESCE(candidate.provider_expires_at, 'infinity'::TIMESTAMPTZ)),
      candidate.huaxin_coupon_id, candidate.coupon_code
    LIMIT v_needed
  )
  INSERT INTO public.admin_coupon_pool_leases (
    huaxin_coupon_id, coupon_code, owner_actor_id, pool_id, leased_at, expires_at
  )
  SELECT candidate.huaxin_coupon_id,
         candidate.coupon_code,
         p_actor_id,
         p_pool_id,
         v_now,
         LEAST(v_now + INTERVAL '24 hours', candidate.group_expires_at, COALESCE(candidate.provider_expires_at, 'infinity'::TIMESTAMPTZ))
  FROM available candidate
  ON CONFLICT (huaxin_coupon_id, coupon_code) DO NOTHING;

  RETURN QUERY
  WITH candidates AS (
    SELECT value->>'huaxin_coupon_id' AS huaxin_coupon_id,
           NULLIF(value->>'coupon_name', '') AS coupon_name,
           value->>'coupon_code' AS coupon_code,
           NULLIF(value->>'provider_expires_at', '')::TIMESTAMPTZ AS provider_expires_at,
           (value->>'group_expires_at')::TIMESTAMPTZ AS group_expires_at,
           NULLIF(value->>'extra_information', '') AS extra_information,
           NULLIF(value->>'metadata_revision', '')::BIGINT AS metadata_revision
    FROM jsonb_array_elements(p_candidates) value
  )
  SELECT lease.huaxin_coupon_id,
         candidate.coupon_name,
         lease.coupon_code,
         candidate.provider_expires_at,
         lease.lease_token,
         lease.expires_at,
         candidate.extra_information,
         candidate.metadata_revision
  FROM public.admin_coupon_pool_leases lease
  JOIN candidates candidate
    ON candidate.huaxin_coupon_id = lease.huaxin_coupon_id
   AND candidate.coupon_code = lease.coupon_code
  WHERE lease.owner_actor_id = p_actor_id
    AND lease.pool_id = p_pool_id
    AND lease.expires_at > v_now
    AND NOT EXISTS (
      SELECT 1 FROM public.coupon_code_metadata metadata
      WHERE metadata.huaxin_coupon_id = lease.huaxin_coupon_id
        AND metadata.coupon_code = lease.coupon_code
        AND metadata.distributed
    )
  ORDER BY LEAST(candidate.group_expires_at, COALESCE(candidate.provider_expires_at, 'infinity'::TIMESTAMPTZ)),
    lease.huaxin_coupon_id, lease.coupon_code
  LIMIT 5;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_admin_coupon_pool(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_coupon_pool(UUID, UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.release_distributed_coupon_lease()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.distributed THEN
    PERFORM pg_advisory_xact_lock(8132284961);
    DELETE FROM public.admin_coupon_pool_leases
    WHERE huaxin_coupon_id = NEW.huaxin_coupon_id AND coupon_code = NEW.coupon_code;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.release_distributed_coupon_lease() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER coupon_code_metadata_release_distributed_lease
AFTER INSERT OR UPDATE OF distributed ON public.coupon_code_metadata
FOR EACH ROW EXECUTE FUNCTION public.release_distributed_coupon_lease();
