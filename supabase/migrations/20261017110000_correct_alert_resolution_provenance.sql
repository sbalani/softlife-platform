UPDATE public.alerts alert
SET resolution_source = 'manual_dismissal'
WHERE alert.resolution_source = 'safety_clearance'
  AND NOT EXISTS (
    SELECT 1
    FROM public.machine_defrost_events event
    WHERE event.run_id::TEXT = alert.entity_key
      AND event.event_type = 'intervention_cleared'
      AND event.occurred_at <= alert.resolved_at + INTERVAL '5 minutes'
  );
