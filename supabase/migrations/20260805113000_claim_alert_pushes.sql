CREATE OR REPLACE FUNCTION public.claim_pending_alert_pushes(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  severity TEXT,
  machine_id UUID,
  message TEXT,
  created_at TIMESTAMPTZ,
  machine_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE public.alerts alert
    SET push_notified_at = now()
    WHERE alert.id IN (
      SELECT pending.id
      FROM public.alerts pending
      WHERE pending.resolved_at IS NULL AND pending.push_notified_at IS NULL
      ORDER BY pending.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    RETURNING alert.id, alert.severity, alert.machine_id, alert.message, alert.created_at
  )
  SELECT claimed.id, claimed.severity, claimed.machine_id, claimed.message, claimed.created_at,
         COALESCE(machine.display_name, machine.name)
  FROM claimed
  LEFT JOIN public.machines machine ON machine.id = claimed.machine_id;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_alert_pushes(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_alert_pushes(INTEGER) TO service_role;
