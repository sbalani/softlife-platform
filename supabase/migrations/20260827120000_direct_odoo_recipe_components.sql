-- Expand-only migration. Keep cup_product_id and the original RPC during the
-- rolling deployment; remove them in a later cleanup migration.
ALTER TABLE public.production_settings
  ADD COLUMN cup_odoo_product_id INTEGER REFERENCES public.odoo_products(odoo_id) ON DELETE RESTRICT;

UPDATE public.production_settings settings
SET cup_odoo_product_id = product.odoo_id
FROM public.products product
WHERE product.id = settings.cup_product_id
  AND product.odoo_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.production_settings
    WHERE cup_product_id IS NOT NULL AND cup_odoo_product_id IS NULL
  ) THEN
    RAISE EXCEPTION 'The configured cup ingredient has no Odoo SKU; link it or clear the setting before migrating';
  END IF;
END;
$$;

-- Freeze the Odoo material identity used by every existing food component.
-- A later products.odoo_id edit must not mutate an immutable recipe version.
ALTER TABLE public.recipe_version_components
  ADD COLUMN odoo_product_id INTEGER REFERENCES public.odoo_products(odoo_id) ON DELETE RESTRICT;

ALTER TABLE public.recipe_version_components DISABLE TRIGGER recipe_version_components_immutable;
UPDATE public.recipe_version_components component
SET odoo_product_id = product.odoo_id
FROM public.products product
WHERE product.id = component.product_id;
ALTER TABLE public.recipe_version_components ENABLE TRIGGER recipe_version_components_immutable;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.recipe_version_components WHERE odoo_product_id IS NULL) THEN
    RAISE EXCEPTION 'Every existing recipe-version ingredient must have an Odoo SKU before migrating';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_recipe_version_component_odoo_product()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.odoo_product_id IS NULL THEN
    SELECT odoo_id INTO NEW.odoo_product_id FROM public.products WHERE id = NEW.product_id;
  END IF;
  IF NEW.odoo_product_id IS NULL THEN RAISE EXCEPTION 'Recipe-version ingredient has no Odoo SKU'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recipe_version_components_set_odoo_product
BEFORE INSERT ON public.recipe_version_components
FOR EACH ROW EXECUTE FUNCTION public.set_recipe_version_component_odoo_product();

ALTER TABLE public.recipe_version_components ALTER COLUMN odoo_product_id SET NOT NULL;

CREATE TABLE public.recipe_version_odoo_components (
  recipe_version_id UUID NOT NULL REFERENCES public.recipe_versions(id) ON DELETE RESTRICT,
  odoo_product_id INTEGER NOT NULL REFERENCES public.odoo_products(odoo_id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  uom TEXT NOT NULL CHECK (NULLIF(btrim(uom), '') IS NOT NULL),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_version_id, odoo_product_id),
  UNIQUE (recipe_version_id, sequence)
);

CREATE TRIGGER recipe_version_odoo_components_immutable
BEFORE UPDATE OR DELETE ON public.recipe_version_odoo_components
FOR EACH ROW EXECUTE FUNCTION public.prevent_recipe_component_mutation();

ALTER TABLE public.recipe_version_odoo_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_version_odoo_components FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.recipe_version_odoo_components TO service_role;

-- This overload is additive. The old (UUID, TEXT, JSONB) function is replaced
-- below with an adapter until all deployed application instances use the new contract.
CREATE FUNCTION public.create_or_reuse_recipe_version(
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
  FROM jsonb_to_recordset(p_components)
    AS component(product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
  JOIN public.products product ON product.id = component.product_id
  WHERE component.product_id IS NOT NULL AND component.odoo_product_id > 0
    AND product.odoo_id = component.odoo_product_id AND component.quantity > 0
    AND NULLIF(btrim(component.uom), '') IS NOT NULL AND component.sequence > 0;

  SELECT count(*) INTO v_odoo_count
  FROM jsonb_to_recordset(p_odoo_components)
    AS component(odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
  WHERE component.odoo_product_id = v_cup_odoo_product_id
    AND component.quantity = 1 AND lower(btrim(component.uom)) = 'unit' AND component.sequence > 0;

  IF v_food_count <> jsonb_array_length(p_components) OR v_odoo_count <> 1 THEN
    RAISE EXCEPTION 'Food components must match their Odoo links and the direct cup must be the configured SKU at 1 unit';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT component.product_id::TEXT AS component_id, 'food' AS component_type, component.sequence
      FROM jsonb_to_recordset(p_components)
        AS component(product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
      UNION ALL
      SELECT component.odoo_product_id::TEXT, 'odoo', component.sequence
      FROM jsonb_to_recordset(p_odoo_components)
        AS component(odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
    ) component
    GROUP BY component.component_type, component.component_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM (
      SELECT component.sequence FROM jsonb_to_recordset(p_components)
        AS component(product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
      UNION ALL
      SELECT component.sequence FROM jsonb_to_recordset(p_odoo_components)
        AS component(odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
    ) component
    GROUP BY component.sequence HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Recipe version component identifiers and sequences must be unique'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_components)
      AS food(product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
    WHERE food.odoo_product_id = v_cup_odoo_product_id
  ) THEN RAISE EXCEPTION 'The cup Odoo SKU cannot also be used by a food ingredient in the same recipe'; END IF;

  SELECT encode(extensions.digest(COALESCE(jsonb_agg(jsonb_build_object(
    'component_type', component.component_type,
    'component_id', component.component_id,
    'odoo_product_id', component.odoo_product_id,
    'quantity', component.quantity,
    'uom', component.uom,
    'sequence', component.sequence
  ) ORDER BY component.component_type, component.component_id)::TEXT, '[]'), 'sha256'), 'hex')
  INTO v_component_hash
  FROM (
    SELECT 'food' AS component_type, component.product_id::TEXT AS component_id,
      component.odoo_product_id, component.quantity, lower(btrim(component.uom)) AS uom, component.sequence
    FROM jsonb_to_recordset(p_components)
      AS component(product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER)
    UNION ALL
    SELECT 'odoo', component.odoo_product_id::TEXT, component.odoo_product_id,
      component.quantity, lower(btrim(component.uom)), component.sequence
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

  INSERT INTO public.recipe_version_components(recipe_version_id, product_id, odoo_product_id, quantity, uom, sequence)
  SELECT v_version.id, component.product_id, component.odoo_product_id,
    component.quantity, lower(btrim(component.uom)), component.sequence
  FROM jsonb_to_recordset(p_components)
    AS component(product_id UUID, odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER);

  INSERT INTO public.recipe_version_odoo_components(recipe_version_id, odoo_product_id, quantity, uom, sequence)
  SELECT v_version.id, component.odoo_product_id, component.quantity, lower(btrim(component.uom)), component.sequence
  FROM jsonb_to_recordset(p_odoo_components)
    AS component(odoo_product_id INTEGER, quantity NUMERIC, uom TEXT, sequence INTEGER);

  RETURN v_version;
END;
$$;

-- Old application instances send the configured cup as a platform ingredient.
-- Convert that legacy shape to the direct Odoo component instead of allowing
-- rolling instances to create versions without packaging.
CREATE OR REPLACE FUNCTION public.create_or_reuse_recipe_version(
  p_recipe_id UUID, p_component_hash TEXT, p_components JSONB
)
RETURNS public.recipe_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cup_product_id UUID;
  v_cup_odoo_product_id INTEGER;
  v_cup_sequence INTEGER;
  v_cup_count INTEGER;
  v_food_count INTEGER;
  v_food_components JSONB;
BEGIN
  IF NULLIF(btrim(p_component_hash), '') IS NULL OR jsonb_typeof(p_components) <> 'array'
    OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'A component hash and non-empty component array are required';
  END IF;

  SELECT cup_product_id, cup_odoo_product_id
  INTO v_cup_product_id, v_cup_odoo_product_id
  FROM public.production_settings WHERE singleton = true;
  IF v_cup_product_id IS NULL OR v_cup_odoo_product_id IS NULL THEN
    RAISE EXCEPTION 'The legacy and direct cup settings must both be configured during rolling deployment';
  END IF;

  SELECT min(component.sequence), count(*)
  INTO v_cup_sequence, v_cup_count
  FROM jsonb_to_recordset(p_components)
    AS component(product_id UUID, quantity NUMERIC, uom TEXT, sequence INTEGER)
  WHERE component.product_id = v_cup_product_id;
  IF v_cup_count <> 1 THEN RAISE EXCEPTION 'The legacy component array must contain the configured cup ingredient exactly once'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', component.product_id,
    'odoo_product_id', product.odoo_id,
    'quantity', component.quantity,
    'uom', component.uom,
    'sequence', component.sequence
  ) ORDER BY component.sequence), '[]'::JSONB)
  INTO v_food_components
  FROM jsonb_to_recordset(p_components)
    AS component(product_id UUID, quantity NUMERIC, uom TEXT, sequence INTEGER)
  JOIN public.products product ON product.id = component.product_id
  WHERE component.product_id <> v_cup_product_id;
  v_food_count := jsonb_array_length(p_components) - 1;
  IF jsonb_array_length(v_food_components) <> v_food_count THEN
    RAISE EXCEPTION 'Every legacy food component must reference an existing platform product';
  END IF;

  RETURN public.create_or_reuse_recipe_version(
    p_recipe_id,
    v_food_components,
    jsonb_build_array(jsonb_build_object(
      'odoo_product_id', v_cup_odoo_product_id,
      'quantity', 1,
      'uom', 'unit',
      'sequence', v_cup_sequence
    ))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_reuse_recipe_version(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_reuse_recipe_version(UUID, JSONB, JSONB) TO service_role;
