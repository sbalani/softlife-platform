CREATE OR REPLACE FUNCTION public.resolve_production_orders_to_recipe(
  p_export_id UUID, p_order_ids UUID[], p_recipe_id UUID, p_actor_id UUID
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_ids UUID[];
  v_order_count INTEGER;
  v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  v_order_ids := ARRAY(SELECT DISTINCT id FROM unnest(COALESCE(p_order_ids, ARRAY[]::UUID[])) id ORDER BY id);
  IF cardinality(v_order_ids) = 0 OR cardinality(v_order_ids) > 200 THEN
    RAISE EXCEPTION 'Between 1 and 200 orders are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = p_recipe_id AND active = true) THEN
    RAISE EXCEPTION 'Active recipe not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin actor not found';
  END IF;

  SELECT * INTO v_export FROM public.manufacturing_period_exports
  WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND OR v_export.initiated_by <> 'platform' OR v_export.status <> 'blocked' OR v_export.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unconfirmed blocked platform preview can be remediated';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_order_ids) AS requested(order_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_export.blocked_reasons) reason
      WHERE reason->>'problem_code' = 'missing_recipe'
        AND reason->>'order_id' = requested.order_id::TEXT
    )
  ) THEN
    RAISE EXCEPTION 'One or more orders are not missing-recipe blockers in this preview';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_order_ids) AS requested(order_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.manufacturing_period_export_orders membership
      WHERE membership.export_id = p_export_id AND membership.order_id = requested.order_id
        AND membership.released_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'The blocked preview no longer owns one or more orders';
  END IF;

  PERFORM order_row.id FROM public.huaxin_orders order_row
  WHERE order_row.id = ANY(v_order_ids) ORDER BY order_row.id FOR UPDATE;
  SELECT count(*) INTO v_order_count FROM public.huaxin_orders WHERE id = ANY(v_order_ids);
  IF v_order_count <> cardinality(v_order_ids) THEN RAISE EXCEPTION 'One or more orders do not exist'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.manufacturing_period_export_orders membership
    JOIN public.huaxin_orders order_row ON order_row.id = membership.order_id
    WHERE membership.export_id = p_export_id AND membership.order_id = ANY(v_order_ids)
      AND (membership.export_version <> order_row.export_version
        OR membership.export_content_hash IS DISTINCT FROM order_row.export_content_hash)
  ) THEN
    RAISE EXCEPTION 'One or more sale resolutions changed; refresh the preview before applying another resolution';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.manufacturing_period_export_orders membership
    JOIN public.manufacturing_period_exports export ON export.id = membership.export_id
    WHERE membership.order_id = ANY(v_order_ids) AND membership.released_at IS NULL
      AND (export.confirmed_at IS NOT NULL OR export.status IN ('ready', 'processing', 'completed'))
  ) THEN
    RAISE EXCEPTION 'A released manufacturing run already owns one or more orders';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_order_ids) AS requested(order_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.order_product_resolutions resolution WHERE resolution.order_id = requested.order_id)
  ) THEN
    RAISE EXCEPTION 'One or more orders have no sale-line evidence to resolve';
  END IF;

  WITH ranked AS (
    SELECT resolution.id,
      row_number() OVER (PARTITION BY resolution.order_id ORDER BY resolution.line_index, resolution.id) AS line_rank
    FROM public.order_product_resolutions resolution
    WHERE resolution.order_id = ANY(v_order_ids)
  )
  UPDATE public.order_product_resolutions resolution SET
    platform_product_id = NULL,
    recipe_id = CASE WHEN ranked.line_rank = 1 THEN p_recipe_id ELSE NULL END,
    recipe_version_id = NULL,
    mapping_method = CASE WHEN ranked.line_rank = 1 THEN 'manual' ELSE 'ignored' END,
    resolution_status = CASE WHEN ranked.line_rank = 1 THEN 'resolved' ELSE 'ignored' END,
    problem_code = NULL,
    resolution_note = CASE WHEN ranked.line_rank = 1
      THEN 'Manual complete-recipe resolution'
      ELSE 'Superseded by manual complete-recipe resolution'
    END,
    resolved_at = now(),
    resolved_by = p_actor_id
  FROM ranked WHERE resolution.id = ranked.id;

  RETURN v_order_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_production_orders_to_recipe(UUID, UUID[], UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_production_orders_to_recipe(UUID, UUID[], UUID, UUID) TO service_role;
