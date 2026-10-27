CREATE FUNCTION public.valid_payout_v4_snapshot(p_snapshot JSONB, p_total_cents BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_base BIGINT;
  v_iva BIGINT;
  v_total BIGINT;
BEGIN
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
    OR p_snapshot->>'version' IS DISTINCT FROM '2'
    OR jsonb_typeof(p_snapshot->'taxBaseCents') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_snapshot->'ivaCents') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_snapshot->'totalCents') IS DISTINCT FROM 'number'
    OR p_snapshot->>'taxBaseCents' !~ '^[0-9]+$'
    OR p_snapshot->>'ivaCents' !~ '^[0-9]+$'
    OR p_snapshot->>'totalCents' !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;
  v_base := (p_snapshot->>'taxBaseCents')::bigint;
  v_iva := (p_snapshot->>'ivaCents')::bigint;
  v_total := (p_snapshot->>'totalCents')::bigint;
  RETURN v_base > 0
    AND v_iva = round(v_base::numeric * 21 / 100)
    AND v_total = v_base + v_iva
    AND p_total_cents = v_total;
EXCEPTION WHEN numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

ALTER TABLE public.franchisee_payout_settlements
  ADD CONSTRAINT franchisee_payout_settlements_v4_snapshot_check CHECK (
    agreement_version IS DISTINCT FROM 'SL-GESTOR-2026-10-27-v4'
    OR (
      contract_acceptance_id IS NOT NULL
      AND public.valid_payout_v4_snapshot(source_snapshot, calculated_total_cents)
    )
  );

REVOKE ALL ON FUNCTION public.valid_payout_v4_snapshot(JSONB, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valid_payout_v4_snapshot(JSONB, BIGINT)
  TO service_role;
