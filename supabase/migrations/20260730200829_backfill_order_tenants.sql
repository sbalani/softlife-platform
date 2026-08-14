UPDATE public.huaxin_orders o
SET tenant_id = COALESCE((
  SELECT a.tenant_id
  FROM public.machine_franchisee_assignments a
  WHERE a.machine_id = o.machine_id
    AND a.start_date <= (o.order_time AT TIME ZONE 'Europe/Madrid')::DATE
    AND (a.end_date IS NULL OR a.end_date >= (o.order_time AT TIME ZONE 'Europe/Madrid')::DATE)
  ORDER BY a.start_date DESC
  LIMIT 1
), (SELECT m.tenant_id FROM public.machines m WHERE m.id = o.machine_id))
WHERE o.tenant_id IS NULL;
