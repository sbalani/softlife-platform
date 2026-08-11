UPDATE public.alerts alert
SET resolved_at = now()
FROM public.machine_change_log change
WHERE alert.change_log_id = change.id
  AND alert.resolved_at IS NULL
  AND change.field = 'ordering_system_fault'
  AND change.metadata->>'raw_value' ~ '^\[(8|9|11|101|104|105|120|255)]';

UPDATE public.change_alert_rules
SET name = 'Unknown operating fault'
WHERE name = 'Ordering system fault'
  AND field = 'ordering_system_fault'
  AND machine_id IS NULL
  AND product_id IS NULL;

INSERT INTO public.change_alert_rules (name, field, rule_type, target_value, severity)
SELECT 'Insufficient mixture proportion', 'mixture_ratio_fault', 'status_equals', 'true', 'critical'
WHERE NOT EXISTS (
  SELECT 1 FROM public.change_alert_rules
  WHERE field = 'mixture_ratio_fault'
    AND machine_id IS NULL
    AND product_id IS NULL
);
