ALTER TABLE public.machine_defrost_runs
  DROP CONSTRAINT machine_defrost_runs_state_check,
  DROP CONSTRAINT machine_defrost_runs_outcome_check,
  ADD CONSTRAINT machine_defrost_runs_state_check CHECK (state IN (
    'scheduled', 'thawing', 'thaw_closed', 'refrigeration_check', 'forming',
    'sales_check', 'recovery', 'completed', 'skipped', 'failed', 'manual_intervention'
  )),
  ADD CONSTRAINT machine_defrost_runs_outcome_check CHECK (outcome IS NULL OR outcome IN ('completed', 'skipped', 'failed', 'manual_intervention'));
