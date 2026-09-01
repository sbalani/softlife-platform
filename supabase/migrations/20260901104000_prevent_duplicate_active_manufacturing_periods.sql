create unique index manufacturing_period_exports_one_active_period_idx
  on public.manufacturing_period_exports (period_from, period_to)
  where status in ('preparing', 'draft', 'blocked', 'ready', 'processing', 'completed');
