CREATE FUNCTION public.canonical_production_uom(p_uom TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(p_uom))
    WHEN 'unit' THEN 'unit' WHEN 'units' THEN 'unit' WHEN 'u' THEN 'unit' WHEN 'pcs' THEN 'unit'
    WHEN 'g' THEN 'g' WHEN 'gram' THEN 'g' WHEN 'grams' THEN 'g'
    WHEN 'kg' THEN 'kg' WHEN 'kilogram' THEN 'kg' WHEN 'kilograms' THEN 'kg'
    WHEN 'ml' THEN 'ml' WHEN 'milliliter' THEN 'ml' WHEN 'milliliters' THEN 'ml'
    WHEN 'millilitre' THEN 'ml' WHEN 'millilitres' THEN 'ml'
    WHEN 'l' THEN 'l' WHEN 'liter' THEN 'l' WHEN 'liters' THEN 'l'
    WHEN 'litre' THEN 'l' WHEN 'litres' THEN 'l'
    ELSE NULL
  END
$$;

CREATE FUNCTION public.production_uom_dimension(p_uom TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE public.canonical_production_uom(p_uom)
    WHEN 'unit' THEN 'unit'
    WHEN 'g' THEN 'weight' WHEN 'kg' THEN 'weight'
    WHEN 'ml' THEN 'volume' WHEN 'l' THEN 'volume'
    ELSE NULL
  END
$$;

CREATE FUNCTION public.production_uom_factor(p_uom TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE public.canonical_production_uom(p_uom)
    WHEN 'unit' THEN 1 WHEN 'g' THEN 1 WHEN 'kg' THEN 1000
    WHEN 'ml' THEN 1 WHEN 'l' THEN 1000 ELSE NULL
  END
$$;

CREATE FUNCTION public.assert_recipe_component_conversions(p_components JSONB)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF jsonb_typeof(p_components) <> 'array' THEN RETURN; END IF;

  -- Keep authoritative mirror rows stable until recipe creation or reuse finishes.
  PERFORM mirror.odoo_id
  FROM public.odoo_products mirror
  JOIN jsonb_to_recordset(p_components) AS component(odoo_product_id INTEGER)
    ON component.odoo_product_id = mirror.odoo_id
  ORDER BY mirror.odoo_id
  FOR SHARE OF mirror;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(
      odoo_product_id INTEGER, quantity NUMERIC, uom TEXT,
      stock_quantity NUMERIC, stock_uom TEXT,
      package_content_quantity NUMERIC, package_content_uom TEXT
    )
    LEFT JOIN public.odoo_products mirror ON mirror.odoo_id = component.odoo_product_id
    WHERE mirror.odoo_id IS NULL
      OR public.canonical_production_uom(component.uom) IS NULL
      OR public.canonical_production_uom(component.stock_uom)
        IS DISTINCT FROM public.canonical_production_uom(mirror.uom)
      OR CASE
        WHEN public.production_uom_dimension(component.uom) = public.production_uom_dimension(mirror.uom)
          AND public.production_uom_dimension(component.uom) IN ('weight', 'volume', 'unit')
        THEN abs(
          component.stock_quantity
          - component.quantity * public.production_uom_factor(component.uom)
            / public.production_uom_factor(mirror.uom)
        ) > 0.000000000001
          OR component.package_content_quantity IS NOT NULL
          OR component.package_content_uom IS NOT NULL
        WHEN public.production_uom_dimension(mirror.uom) = 'unit'
          AND public.production_uom_dimension(component.uom) IN ('weight', 'volume')
        THEN mirror.package_content_quantity IS NULL
          OR public.production_uom_dimension(component.uom)
            IS DISTINCT FROM public.production_uom_dimension(mirror.package_content_uom)
          OR component.package_content_quantity IS DISTINCT FROM mirror.package_content_quantity
          OR public.canonical_production_uom(component.package_content_uom)
            IS DISTINCT FROM public.canonical_production_uom(mirror.package_content_uom)
          OR abs(
            component.stock_quantity
            - component.quantity * public.production_uom_factor(component.uom)
              / (mirror.package_content_quantity * public.production_uom_factor(mirror.package_content_uom))
          ) > 0.000000000001
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'Frozen stock conversion does not match the authoritative Odoo product mirror';
  END IF;
END;
$$;

ALTER FUNCTION public.create_or_reuse_recipe_version_v2(UUID, JSONB, JSONB)
  RENAME TO create_or_reuse_recipe_version_v2_unchecked;

REVOKE ALL ON FUNCTION public.create_or_reuse_recipe_version_v2_unchecked(UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_or_reuse_recipe_version_v2(
  p_recipe_id UUID, p_components JSONB, p_odoo_components JSONB
)
RETURNS public.recipe_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_version public.recipe_versions%ROWTYPE;
BEGIN
  PERFORM public.assert_recipe_component_conversions(p_components);
  SELECT * INTO v_version
  FROM public.create_or_reuse_recipe_version_v2_unchecked(p_recipe_id, p_components, p_odoo_components);
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_reuse_recipe_version_v2(UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_reuse_recipe_version_v2(UUID, JSONB, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.canonical_production_uom(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.production_uom_dimension(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.production_uom_factor(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_recipe_component_conversions(JSONB) FROM PUBLIC, anon, authenticated, service_role;
