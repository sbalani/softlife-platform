CREATE FUNCTION public.resolve_production_recipe_assignments(
  p_export_id UUID, p_assignments JSONB, p_actor_id UUID
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_assignment JSONB;
  v_order_ids UUID[];
  v_recipe_id UUID;
  v_assignment_count INTEGER;
  v_order_count INTEGER;
  v_distinct_order_count INTEGER;
  v_resolved_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Recipe assignments must be an array';
  END IF;
  v_assignment_count := jsonb_array_length(p_assignments);
  IF v_assignment_count = 0 OR v_assignment_count > 100 THEN
    RAISE EXCEPTION 'Between 1 and 100 recipe assignments are required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) AS assignment(value)
    WHERE jsonb_typeof(assignment.value) <> 'object'
      OR jsonb_typeof(assignment.value->'order_ids') <> 'array'
      OR NULLIF(assignment.value->>'recipe_id', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Every recipe assignment requires recipe_id and order_ids';
  END IF;

  SELECT count(*), count(DISTINCT order_id)
  INTO v_order_count, v_distinct_order_count
  FROM jsonb_array_elements(p_assignments) AS assignment(value)
  CROSS JOIN LATERAL jsonb_array_elements_text(assignment.value->'order_ids') order_row(order_id);
  IF v_order_count = 0 OR v_order_count > 2000 OR v_order_count <> v_distinct_order_count THEN
    RAISE EXCEPTION 'Assignments require between 1 and 2000 unique orders';
  END IF;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(p_assignments)
  LOOP
    IF jsonb_typeof(v_assignment->'order_ids') <> 'array' THEN
      RAISE EXCEPTION 'Every recipe assignment requires order_ids';
    END IF;
    v_recipe_id := (v_assignment->>'recipe_id')::UUID;
    v_order_ids := ARRAY(
      SELECT DISTINCT value::UUID
      FROM jsonb_array_elements_text(v_assignment->'order_ids')
      ORDER BY value::UUID
    );
    v_resolved_count := v_resolved_count + public.resolve_production_orders_to_recipe(
      p_export_id, v_order_ids, v_recipe_id, p_actor_id
    );
  END LOOP;
  RETURN v_resolved_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_production_recipe_assignments(UUID, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_production_recipe_assignments(UUID, JSONB, UUID)
  TO service_role;
