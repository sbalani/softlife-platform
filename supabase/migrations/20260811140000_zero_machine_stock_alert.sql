INSERT INTO public.change_alert_rules (
  name, field, rule_type, min_value, severity
)
SELECT 'Machine product stock empty', 'stock', 'numeric_range', 1, 'critical'
WHERE NOT EXISTS (
  SELECT 1 FROM public.change_alert_rules
  WHERE field = 'stock'
    AND machine_id IS NULL
    AND product_id IS NULL
    AND rule_type = 'numeric_range'
    AND min_value = 1
    AND max_value IS NULL
);
