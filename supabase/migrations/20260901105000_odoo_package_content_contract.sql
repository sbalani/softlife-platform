-- Expand-only mirror fields. Existing softlife_sync deployments can continue
-- upserting rows without package metadata during the rolling deployment.
ALTER TABLE public.odoo_products
  ADD COLUMN package_content_quantity NUMERIC,
  ADD COLUMN package_content_uom TEXT;

ALTER TABLE public.odoo_products
  ADD CONSTRAINT odoo_products_package_content_pair CHECK (
    (package_content_quantity IS NULL AND package_content_uom IS NULL)
    OR (package_content_quantity > 0 AND NULLIF(btrim(package_content_uom), '') IS NOT NULL)
  );

-- These nullable snapshots are populated only by the new versioned recipe RPC.
-- Historical recipe versions remain byte-for-byte unchanged.
ALTER TABLE public.recipe_version_components
  ADD COLUMN stock_quantity NUMERIC,
  ADD COLUMN stock_uom TEXT,
  ADD COLUMN package_content_quantity NUMERIC,
  ADD COLUMN package_content_uom TEXT;

ALTER TABLE public.recipe_version_components
  ADD CONSTRAINT recipe_version_components_stock_pair CHECK (
    (stock_quantity IS NULL AND stock_uom IS NULL)
    OR (stock_quantity > 0 AND NULLIF(btrim(stock_uom), '') IS NOT NULL)
  ),
  ADD CONSTRAINT recipe_version_components_package_pair CHECK (
    (package_content_quantity IS NULL AND package_content_uom IS NULL)
    OR (package_content_quantity > 0 AND NULLIF(btrim(package_content_uom), '') IS NOT NULL)
  );

REVOKE INSERT, UPDATE, DELETE ON public.recipe_version_components FROM service_role;

CREATE FUNCTION public.create_or_reuse_recipe_version_v2(
  p_recipe_id UUID, p_components JSONB, p_odoo_components JSONB
)
RETURNS public.recipe_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_version public.recipe_versions%ROWTYPE;
  v_next_version INTEGER;
  v_component_hash TEXT;
  v_food_count INTEGER;
  v_odoo_count INTEGER;
  v_cup_odoo_product_id INTEGER;
BEGIN
  IF jsonb_typeof(p_components) <> 'array' OR jsonb_array_length(p_components) = 0
    OR jsonb_typeof(p_odoo_components) <> 'array' OR jsonb_array_length(p_odoo_components) <> 1 THEN
    RAISE EXCEPTION 'A non-empty food component array and exactly one direct cup component are required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = p_recipe_id) THEN RAISE EXCEPTION 'Recipe not found'; END IF;
  SELECT cup_odoo_product_id INTO v_cup_odoo_product_id FROM public.production_settings WHERE singleton = true;
  IF v_cup_odoo_product_id IS NULL THEN RAISE EXCEPTION 'The global cup Odoo SKU is not configured'; END IF;

  SELECT count(*) INTO v_food_count
  FROM jsonb_to_recordset(p_components) AS component(
    product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER,
    stock_quantity NUMERIC, stock_uom TEXT, package_content_quantity NUMERIC, package_content_uom TEXT
  )
  JOIN public.products product ON product.id = component.product_id
  WHERE component.product_id IS NOT NULL AND component.odoo_product_id > 0
    AND product.odoo_id = component.odoo_product_id AND component.quantity > 0
    AND NULLIF(btrim(component.uom), '') IS NOT NULL AND component.sequence > 0
    AND component.stock_quantity > 0 AND NULLIF(btrim(component.stock_uom), '') IS NOT NULL
    AND ((component.package_content_quantity IS NULL AND component.package_content_uom IS NULL)
      OR (component.package_content_quantity > 0 AND NULLIF(btrim(component.package_content_uom), '') IS NOT NULL));

  SELECT count(*) INTO v_odoo_count
  FROM jsonb_to_recordset(p_odoo_components)
    AS component(odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
  WHERE component.odoo_product_id = v_cup_odoo_product_id
    AND component.quantity = 1 AND lower(btrim(component.uom)) = 'unit' AND component.sequence > 0;

  IF v_food_count <> jsonb_array_length(p_components) OR v_odoo_count <> 1 THEN
    RAISE EXCEPTION 'Every component must contain valid physical and frozen stock quantities';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT component.product_id::TEXT AS component_id, 'food' AS component_type, component.sequence
      FROM jsonb_to_recordset(p_components) AS component(product_id UUID, sequence INTEGER)
      UNION ALL
      SELECT component.odoo_product_id::TEXT, 'odoo', component.sequence
      FROM jsonb_to_recordset(p_odoo_components) AS component(odoo_product_id INTEGER, sequence INTEGER)
    ) component GROUP BY component.component_type, component.component_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM (
      SELECT component.sequence FROM jsonb_to_recordset(p_components) AS component(sequence INTEGER)
      UNION ALL
      SELECT component.sequence FROM jsonb_to_recordset(p_odoo_components) AS component(sequence INTEGER)
    ) component GROUP BY component.sequence HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Recipe version component identifiers and sequences must be unique'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_components) AS food(odoo_product_id INTEGER)
    WHERE food.odoo_product_id = v_cup_odoo_product_id
  ) THEN RAISE EXCEPTION 'The cup Odoo SKU cannot also be used by a food ingredient in the same recipe'; END IF;

  SELECT encode(extensions.digest(COALESCE(jsonb_agg(jsonb_build_object(
    'contract_version', 2, 'component_type', component.component_type,
    'component_id', component.component_id, 'odoo_product_id', component.odoo_product_id,
    'quantity', component.quantity, 'uom', component.uom, 'sequence', component.sequence,
    'stock_quantity', component.stock_quantity, 'stock_uom', component.stock_uom,
    'package_content_quantity', component.package_content_quantity,
    'package_content_uom', component.package_content_uom
  ) ORDER BY component.component_type, component.component_id)::TEXT, '[]'), 'sha256'), 'hex')
  INTO v_component_hash
  FROM (
    SELECT 'food' AS component_type, component.product_id::TEXT AS component_id,
      component.odoo_product_id, component.quantity, lower(btrim(component.uom)) AS uom,
      component.sequence, component.stock_quantity, lower(btrim(component.stock_uom)) AS stock_uom,
      component.package_content_quantity,
      CASE WHEN component.package_content_uom IS NULL THEN NULL ELSE lower(btrim(component.package_content_uom)) END AS package_content_uom
    FROM jsonb_to_recordset(p_components) AS component(
      product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER,
      stock_quantity NUMERIC, stock_uom TEXT, package_content_quantity NUMERIC, package_content_uom TEXT
    )
    UNION ALL
    SELECT 'odoo', component.odoo_product_id::TEXT, component.odoo_product_id,
      component.quantity, lower(btrim(component.uom)), component.sequence,
      component.quantity, lower(btrim(component.uom)), NULL::NUMERIC, NULL::TEXT
    FROM jsonb_to_recordset(p_odoo_components)
      AS component(odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
  ) component;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_recipe_id::TEXT, 0));
  SELECT * INTO v_version FROM public.recipe_versions
  WHERE recipe_id = p_recipe_id AND component_hash = v_component_hash;
  IF FOUND THEN RETURN v_version; END IF;

  SELECT COALESCE(max(version), 0) + 1 INTO v_next_version FROM public.recipe_versions WHERE recipe_id = p_recipe_id;
  INSERT INTO public.recipe_versions(recipe_id, version, component_hash)
  VALUES (p_recipe_id, v_next_version, v_component_hash) RETURNING * INTO v_version;

  INSERT INTO public.recipe_version_components(
    recipe_version_id, product_id, odoo_product_id, quantity, uom, sequence,
    stock_quantity, stock_uom, package_content_quantity, package_content_uom
  )
  SELECT v_version.id, component.product_id, component.odoo_product_id,
    component.quantity, lower(btrim(component.uom)), component.sequence,
    component.stock_quantity, lower(btrim(component.stock_uom)), component.package_content_quantity,
    CASE WHEN component.package_content_uom IS NULL THEN NULL ELSE lower(btrim(component.package_content_uom)) END
  FROM jsonb_to_recordset(p_components) AS component(
    product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER,
    stock_quantity NUMERIC, stock_uom TEXT, package_content_quantity NUMERIC, package_content_uom TEXT
  );

  INSERT INTO public.recipe_version_odoo_components(recipe_version_id, odoo_product_id, quantity, uom, sequence)
  SELECT v_version.id, component.odoo_product_id, component.quantity, lower(btrim(component.uom)), component.sequence
  FROM jsonb_to_recordset(p_odoo_components)
    AS component(odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER);
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_reuse_recipe_version_v2(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_reuse_recipe_version_v2(UUID, JSONB, JSONB) TO service_role;
