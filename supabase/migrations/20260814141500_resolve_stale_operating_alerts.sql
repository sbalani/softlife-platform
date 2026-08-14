WITH operating AS (
  SELECT snapshot.machine_id, snapshot.raw, snapshot.observed_at,
         CASE (regexp_match(COALESCE(snapshot.raw->>'value', ''), '^\[(\d+)]'))[1]
           WHEN '8' THEN 'material_empty'
           WHEN '101' THEN 'cup_empty'
           WHEN '102' THEN 'material_out'
           WHEN '104' THEN 'cup_take_fault'
           WHEN '120' THEN 'cup_foreign_object'
           WHEN '255' THEN 'mixture_ratio_fault'
           ELSE NULL
         END AS active_field
  FROM public.machine_status_snapshots snapshot
  WHERE snapshot.field = 'raw:status_0_os'
), stale AS (
  SELECT signal.machine_id, signal.field, operating.raw, operating.observed_at
  FROM public.machine_status_snapshots signal
  JOIN operating ON operating.machine_id = signal.machine_id
  WHERE signal.field IN ('material_empty', 'cup_empty', 'material_out', 'cup_take_fault', 'cup_foreign_object', 'mixture_ratio_fault')
    AND signal.value #>> '{}' = 'true'
    AND signal.field IS DISTINCT FROM operating.active_field
)
INSERT INTO public.machine_change_log (
  machine_id, device_imei, machine_name, source, action, entity_type,
  entity_key, field, new_value, metadata
)
SELECT stale.machine_id, machine.device_imei, COALESCE(machine.display_name, machine.name),
       'machine_sync', 'status_changed', 'machine_status', stale.field, stale.field,
       'false'::JSONB, jsonb_build_object(
         'description', stale.raw->>'desc', 'raw_value', stale.raw->>'value',
         'raw_data', stale.raw->>'data', 'reconciled', true
       )
FROM stale
JOIN public.machines machine ON machine.id = stale.machine_id;

WITH operating AS (
  SELECT snapshot.machine_id, snapshot.raw, snapshot.observed_at,
         CASE (regexp_match(COALESCE(snapshot.raw->>'value', ''), '^\[(\d+)]'))[1]
           WHEN '8' THEN 'material_empty'
           WHEN '101' THEN 'cup_empty'
           WHEN '102' THEN 'material_out'
           WHEN '104' THEN 'cup_take_fault'
           WHEN '120' THEN 'cup_foreign_object'
           WHEN '255' THEN 'mixture_ratio_fault'
           ELSE NULL
         END AS active_field
  FROM public.machine_status_snapshots snapshot
  WHERE snapshot.field = 'raw:status_0_os'
)
UPDATE public.machine_status_snapshots signal
SET value = 'false'::JSONB, raw = operating.raw, observed_at = operating.observed_at
FROM operating
WHERE signal.machine_id = operating.machine_id
  AND signal.field IN ('material_empty', 'cup_empty', 'material_out', 'cup_take_fault', 'cup_foreign_object', 'mixture_ratio_fault')
  AND signal.value #>> '{}' = 'true'
  AND signal.field IS DISTINCT FROM operating.active_field;
