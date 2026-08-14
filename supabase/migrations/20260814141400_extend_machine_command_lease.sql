CREATE OR REPLACE FUNCTION public.claim_interactive_machine_command(p_machine_id UUID, p_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::TEXT, 0));
  IF EXISTS (SELECT 1 FROM public.machine_defrost_runs WHERE machine_id = p_machine_id AND state IN ('scheduled','thawing','thaw_closed','forming','recovery'))
    OR EXISTS (SELECT 1 FROM public.machine_defrost_schedules WHERE machine_id = p_machine_id AND requires_intervention)
  THEN RETURN false;
  END IF;
  INSERT INTO public.machine_command_leases (machine_id, owner_token, purpose, lease_until)
  VALUES (p_machine_id, p_owner, 'interactive', now() + INTERVAL '3 minutes')
  ON CONFLICT (machine_id) DO UPDATE SET owner_token = EXCLUDED.owner_token, purpose = EXCLUDED.purpose, lease_until = EXCLUDED.lease_until
  WHERE machine_command_leases.lease_until < now();
  RETURN EXISTS (SELECT 1 FROM public.machine_command_leases WHERE machine_id = p_machine_id AND owner_token = p_owner);
END;
$$;
