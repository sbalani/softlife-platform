CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.normalize_observed_name(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT lower(regexp_replace(btrim(normalize(COALESCE(p_value, ''), NFKC)), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

ALTER TABLE public.products
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN default_portion_uom TEXT,
  ADD COLUMN consumption_type TEXT;

UPDATE public.products SET consumption_type = CASE type
  WHEN 'base' THEN 'base'
  WHEN 'topping' THEN 'solid_topping'
  WHEN 'sauce' THEN 'liquid_topping'
  ELSE NULL END;
UPDATE public.products SET default_portion_uom = 'g'
WHERE default_portion_size > 0 AND default_portion_uom IS NULL;
UPDATE public.products SET default_portion_size = NULL, default_portion_uom = NULL
WHERE default_portion_size IS NOT NULL AND default_portion_size <= 0;

ALTER TABLE public.products
  ADD CONSTRAINT products_consumption_type_check CHECK (consumption_type IS NULL OR consumption_type IN ('base', 'solid_topping', 'liquid_topping', 'cup')),
  ADD CONSTRAINT products_default_portion_check CHECK (
    (default_portion_size IS NULL AND default_portion_uom IS NULL)
    OR (default_portion_size > 0 AND NULLIF(btrim(default_portion_uom), '') IS NOT NULL)
  );

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_aliases ADD COLUMN normalized_alias TEXT;
UPDATE public.product_aliases SET normalized_alias = public.normalize_observed_name(alias);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_aliases WHERE normalized_alias = '') THEN
    RAISE EXCEPTION 'Empty product aliases must be removed before applying the Odoo manufacturing contract';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_aliases GROUP BY normalized_alias HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized product aliases must be resolved before applying the Odoo manufacturing contract';
  END IF;
END;
$$;
ALTER TABLE public.product_aliases ALTER COLUMN normalized_alias SET NOT NULL;
DROP INDEX IF EXISTS public.product_aliases_normalized_unique;
CREATE UNIQUE INDEX product_aliases_normalized_unique ON public.product_aliases(normalized_alias);

CREATE OR REPLACE FUNCTION public.set_product_alias_normalized()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.alias := btrim(NEW.alias);
  NEW.normalized_alias := public.normalize_observed_name(NEW.alias);
  IF NEW.normalized_alias = '' THEN RAISE EXCEPTION 'Alias cannot be empty'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_aliases_set_normalized BEFORE INSERT OR UPDATE OF alias ON public.product_aliases
FOR EACH ROW EXECUTE FUNCTION public.set_product_alias_normalized();

CREATE OR REPLACE FUNCTION public.touch_product_for_alias()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.products SET updated_at = now() WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;
  UPDATE public.products SET updated_at = now() WHERE id = NEW.product_id;
  IF TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
    UPDATE public.products SET updated_at = now() WHERE id = OLD.product_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_aliases_touch_product AFTER INSERT OR UPDATE OR DELETE ON public.product_aliases
FOR EACH ROW EXECUTE FUNCTION public.touch_product_for_alias();

CREATE TABLE public.production_consumption_defaults (
  consumption_type TEXT PRIMARY KEY CHECK (consumption_type IN ('base', 'solid_topping', 'liquid_topping')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  uom TEXT NOT NULL CHECK (NULLIF(btrim(uom), '') IS NOT NULL),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER production_consumption_defaults_set_updated_at BEFORE UPDATE ON public.production_consumption_defaults
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.production_product_consumption_overrides (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  uom TEXT NOT NULL CHECK (NULLIF(btrim(uom), '') IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER production_product_consumption_overrides_set_updated_at BEFORE UPDATE ON public.production_product_consumption_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.touch_product_for_consumption_override()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.products SET updated_at = now() WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.product_id ELSE NEW.product_id END;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER production_product_consumption_overrides_touch_product
AFTER INSERT OR UPDATE OR DELETE ON public.production_product_consumption_overrides
FOR EACH ROW EXECUTE FUNCTION public.touch_product_for_consumption_override();

CREATE TABLE public.machine_product_consumption_overrides (
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  uom TEXT NOT NULL CHECK (NULLIF(btrim(uom), '') IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (machine_id, product_id)
);
CREATE TRIGGER machine_product_consumption_overrides_set_updated_at BEFORE UPDATE ON public.machine_product_consumption_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.production_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  cup_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (char_length(currency) = 3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.production_settings(singleton) VALUES (true);
CREATE TRIGGER production_settings_set_updated_at BEFORE UPDATE ON public.production_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.odoo_warehouses ADD COLUMN sales_customer_odoo_id INTEGER;

CREATE TABLE public.recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (NULLIF(btrim(name), '') IS NOT NULL),
  name_translations JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  odoo_finished_product_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER recipes_set_updated_at BEFORE UPDATE ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.recipe_components (
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, product_id),
  UNIQUE (recipe_id, sequence)
);

CREATE TABLE public.recipe_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  component_hash TEXT NOT NULL,
  odoo_bom_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, version),
  UNIQUE (recipe_id, component_hash)
);
CREATE TRIGGER recipe_versions_set_updated_at BEFORE UPDATE ON public.recipe_versions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.protect_recipe_identity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.identity_hash IS DISTINCT FROM OLD.identity_hash THEN RAISE EXCEPTION 'Recipe identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.protect_recipe_version_identity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (
    NEW.recipe_id IS DISTINCT FROM OLD.recipe_id OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.component_hash IS DISTINCT FROM OLD.component_hash
  ) THEN RAISE EXCEPTION 'Recipe version identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recipes_protect_identity BEFORE UPDATE ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.protect_recipe_identity();
CREATE TRIGGER recipe_versions_protect_identity BEFORE UPDATE ON public.recipe_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_recipe_version_identity();

CREATE OR REPLACE FUNCTION public.touch_recipe_versions()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.recipe_versions SET updated_at = now() WHERE recipe_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recipes_touch_versions AFTER UPDATE OF name, name_translations, active, odoo_finished_product_id ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.touch_recipe_versions();

CREATE TABLE public.recipe_version_components (
  recipe_version_id UUID NOT NULL REFERENCES public.recipe_versions(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  uom TEXT NOT NULL CHECK (NULLIF(btrim(uom), '') IS NOT NULL),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_version_id, product_id),
  UNIQUE (recipe_version_id, sequence)
);

CREATE OR REPLACE FUNCTION public.prevent_recipe_component_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Recipe components and version components are immutable'; END;
$$;
CREATE TRIGGER recipe_components_immutable BEFORE UPDATE OR DELETE ON public.recipe_components
FOR EACH ROW EXECUTE FUNCTION public.prevent_recipe_component_mutation();
CREATE TRIGGER recipe_version_components_immutable BEFORE UPDATE OR DELETE ON public.recipe_version_components
FOR EACH ROW EXECUTE FUNCTION public.prevent_recipe_component_mutation();

CREATE OR REPLACE FUNCTION public.create_or_reuse_recipe_version(
  p_recipe_id UUID, p_component_hash TEXT, p_components JSONB
)
RETURNS public.recipe_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version public.recipe_versions%ROWTYPE; v_next_version INTEGER; v_component_hash TEXT;
BEGIN
  IF NULLIF(btrim(p_component_hash), '') IS NULL OR jsonb_typeof(p_components) <> 'array'
    OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'A component hash and non-empty component array are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = p_recipe_id) THEN RAISE EXCEPTION 'Recipe not found'; END IF;
  SELECT encode(extensions.digest(COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', component.product_id, 'quantity', component.quantity, 'uom', btrim(component.uom)
  ) ORDER BY component.product_id)::TEXT, '[]'), 'sha256'), 'hex') INTO v_component_hash
  FROM jsonb_to_recordset(p_components) AS component(product_id UUID, quantity NUMERIC, uom TEXT, sequence INTEGER);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_recipe_id::TEXT, 0));
  SELECT * INTO v_version FROM public.recipe_versions
    WHERE recipe_id = p_recipe_id AND component_hash = v_component_hash;
  IF FOUND THEN RETURN v_version; END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_next_version FROM public.recipe_versions WHERE recipe_id = p_recipe_id;
  INSERT INTO public.recipe_versions(recipe_id, version, component_hash)
    VALUES (p_recipe_id, v_next_version, v_component_hash) RETURNING * INTO v_version;
  INSERT INTO public.recipe_version_components(recipe_version_id, product_id, quantity, uom, sequence)
  SELECT v_version.id, component.product_id, component.quantity, btrim(component.uom), component.sequence
  FROM jsonb_to_recordset(p_components) AS component(product_id UUID, quantity NUMERIC, uom TEXT, sequence INTEGER);
  IF (SELECT count(*) FROM public.recipe_version_components WHERE recipe_version_id = v_version.id) <> jsonb_array_length(p_components) THEN
    RAISE EXCEPTION 'Recipe version components must be valid and unique';
  END IF;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_recipe_odoo_result(
  p_recipe_version_id UUID, p_component_hash TEXT, p_odoo_finished_product_id INTEGER, p_odoo_bom_id INTEGER
)
RETURNS public.recipe_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version public.recipe_versions%ROWTYPE; v_recipe_id UUID; v_finished_product_id INTEGER;
BEGIN
  SELECT recipe_id INTO v_recipe_id FROM public.recipe_versions WHERE id = p_recipe_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe version not found'; END IF;
  SELECT odoo_finished_product_id INTO v_finished_product_id FROM public.recipes WHERE id = v_recipe_id FOR UPDATE;
  SELECT * INTO v_version FROM public.recipe_versions WHERE id = p_recipe_version_id FOR UPDATE;
  IF v_version.component_hash <> p_component_hash THEN RAISE EXCEPTION 'Stale component hash' USING ERRCODE = 'P0002'; END IF;
  IF p_odoo_finished_product_id <= 0 OR p_odoo_bom_id <= 0 THEN RAISE EXCEPTION 'Odoo identifiers must be positive'; END IF;
  IF v_version.odoo_bom_id IS NOT NULL AND v_version.odoo_bom_id <> p_odoo_bom_id THEN
    RAISE EXCEPTION 'Recipe version is already linked to another BOM' USING ERRCODE = 'P0001';
  END IF;
  IF v_finished_product_id IS NOT NULL AND v_finished_product_id <> p_odoo_finished_product_id THEN
    RAISE EXCEPTION 'Recipe is already linked to another finished product' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.recipes SET odoo_finished_product_id = p_odoo_finished_product_id WHERE id = v_version.recipe_id;
  UPDATE public.recipe_versions SET odoo_bom_id = p_odoo_bom_id WHERE id = p_recipe_version_id RETURNING * INTO v_version;
  RETURN v_version;
END;
$$;

CREATE UNIQUE INDEX recipes_odoo_finished_product_unique ON public.recipes(odoo_finished_product_id)
WHERE odoo_finished_product_id IS NOT NULL;
CREATE UNIQUE INDEX recipe_versions_odoo_bom_unique ON public.recipe_versions(odoo_bom_id)
WHERE odoo_bom_id IS NOT NULL;

CREATE TABLE public.machine_menu_recipe_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  menu_kind TEXT NOT NULL CHECK (menu_kind IN ('diy', 'unify')),
  menu_position TEXT NOT NULL CHECK (NULLIF(btrim(menu_position), '') IS NOT NULL),
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE RESTRICT,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('direct_push', 'draft_push', 'menu_copy', 'manual', 'sync')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  EXCLUDE USING gist (
    machine_id WITH =, menu_kind WITH =, menu_position WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  )
);
CREATE INDEX machine_menu_recipe_assignments_lookup_idx
  ON public.machine_menu_recipe_assignments(machine_id, menu_kind, menu_position, valid_from DESC);

CREATE OR REPLACE FUNCTION public.create_or_reuse_recipe(p_product_ids UUID[], p_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids UUID[]; v_hash TEXT; v_id UUID; v_count INTEGER;
BEGIN
  v_ids := ARRAY(SELECT DISTINCT id FROM unnest(COALESCE(p_product_ids, ARRAY[]::UUID[])) id ORDER BY id);
  IF cardinality(v_ids) = 0 OR cardinality(v_ids) <> cardinality(p_product_ids) THEN RAISE EXCEPTION 'Recipe ingredients must be non-empty and unique'; END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE id = ANY(v_ids);
  IF v_count <> cardinality(v_ids) THEN RAISE EXCEPTION 'One or more recipe ingredients do not exist'; END IF;
  v_hash := encode(extensions.digest(array_to_string(v_ids, ','), 'sha256'), 'hex');
  INSERT INTO public.recipes(identity_hash, name) VALUES (v_hash, btrim(p_name))
  ON CONFLICT (identity_hash) DO UPDATE SET name = CASE WHEN public.recipes.name = '' THEN EXCLUDED.name ELSE public.recipes.name END
  RETURNING id INTO v_id;
  IF NOT EXISTS (SELECT 1 FROM public.recipe_components WHERE recipe_id = v_id) THEN
    INSERT INTO public.recipe_components(recipe_id, product_id, sequence)
    SELECT v_id, id, ordinality::INTEGER FROM unnest(p_product_ids) WITH ORDINALITY AS item(id, ordinality);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_menu_recipe_assignment(
  p_machine_id UUID, p_menu_kind TEXT, p_menu_position TEXT, p_recipe_id UUID,
  p_source TEXT, p_actor_id UUID, p_effective_at TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_menu_kind NOT IN ('diy', 'unify') THEN RAISE EXCEPTION 'Invalid menu kind'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.machines WHERE id = p_machine_id) THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = p_recipe_id) THEN RAISE EXCEPTION 'Recipe not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::text || ':' || p_menu_kind || ':' || p_menu_position, 0));
  SELECT id INTO v_id FROM public.machine_menu_recipe_assignments
  WHERE machine_id = p_machine_id AND menu_kind = p_menu_kind AND menu_position = p_menu_position
    AND recipe_id = p_recipe_id AND valid_to IS NULL;
  IF FOUND THEN RETURN v_id; END IF;
  UPDATE public.machine_menu_recipe_assignments SET valid_to = p_effective_at
  WHERE machine_id = p_machine_id AND menu_kind = p_menu_kind AND menu_position = p_menu_position AND valid_to IS NULL;
  INSERT INTO public.machine_menu_recipe_assignments(machine_id, menu_kind, menu_position, recipe_id, valid_from, source, created_by)
  VALUES (p_machine_id, p_menu_kind, p_menu_position, p_recipe_id, p_effective_at, p_source, p_actor_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_menu_recipe_assignments(
  p_machine_id UUID, p_assignments JSONB, p_actor_id UUID, p_effective_at TIMESTAMPTZ DEFAULT now()
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_assignment RECORD; v_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_assignments) <> 'array' THEN RAISE EXCEPTION 'Assignments must be an array'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments) AS item(menu_kind TEXT, menu_position TEXT, recipe_id UUID, source TEXT)
    GROUP BY item.menu_kind, item.menu_position HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Duplicate menu assignment position'; END IF;
  FOR v_assignment IN
    SELECT * FROM jsonb_to_recordset(p_assignments) AS item(menu_kind TEXT, menu_position TEXT, recipe_id UUID, source TEXT)
    ORDER BY item.menu_kind, item.menu_position
  LOOP
    PERFORM public.activate_menu_recipe_assignment(
      p_machine_id, v_assignment.menu_kind, v_assignment.menu_position,
      v_assignment.recipe_id, v_assignment.source, p_actor_id, p_effective_at
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE TABLE public.menu_recipe_push_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  assignments JSONB NOT NULL CHECK (jsonb_typeof(assignments) = 'array' AND jsonb_array_length(assignments) > 0),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX menu_recipe_push_operations_pending_idx ON public.menu_recipe_push_operations(machine_id, requested_at)
WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.complete_menu_recipe_push(p_operation_id UUID, p_effective_at TIMESTAMPTZ)
RETURNS public.menu_recipe_push_operations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_operation public.menu_recipe_push_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_operation FROM public.menu_recipe_push_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu push operation not found'; END IF;
  IF v_operation.status = 'applied' THEN RETURN v_operation; END IF;
  IF v_operation.status <> 'pending' THEN RAISE EXCEPTION 'Menu push operation is not pending'; END IF;
  PERFORM public.activate_menu_recipe_assignments(v_operation.machine_id, v_operation.assignments, v_operation.requested_by, p_effective_at);
  UPDATE public.menu_recipe_push_operations SET status = 'applied', applied_at = p_effective_at, error = NULL
    WHERE id = p_operation_id RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.machine_warehouse_assignments first_assignment
    JOIN public.machine_warehouse_assignments second_assignment
      ON second_assignment.machine_id = first_assignment.machine_id AND second_assignment.id > first_assignment.id
      AND tstzrange(first_assignment.valid_from, COALESCE(first_assignment.valid_to, 'infinity'::TIMESTAMPTZ), '[)')
        && tstzrange(second_assignment.valid_from, COALESCE(second_assignment.valid_to, 'infinity'::TIMESTAMPTZ), '[)')
  ) THEN RAISE EXCEPTION 'Overlapping machine warehouse assignments must be repaired before applying the Odoo manufacturing contract'; END IF;
END;
$$;

ALTER TABLE public.machine_warehouse_assignments
  ADD CONSTRAINT machine_warehouse_assignments_no_overlap EXCLUDE USING gist (
    machine_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  );

ALTER TABLE public.huaxin_orders
  ADD COLUMN export_version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN export_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN export_content_hash TEXT,
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (char_length(currency) = 3),
  ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  ADD COLUMN warehouse_assignment_id UUID REFERENCES public.machine_warehouse_assignments(id) ON DELETE RESTRICT,
  ADD COLUMN odoo_warehouse_id_at_sale INTEGER REFERENCES public.odoo_warehouses(odoo_id) ON DELETE RESTRICT;

WITH historical_assignments AS (
  SELECT order_row.id AS order_id, assignment.id AS assignment_id, assignment.odoo_warehouse_id
  FROM public.huaxin_orders order_row
  LEFT JOIN LATERAL (
    SELECT candidate.id, candidate.odoo_warehouse_id
    FROM public.machine_warehouse_assignments candidate
    WHERE candidate.machine_id = order_row.machine_id AND candidate.valid_from <= order_row.order_time
      AND (candidate.valid_to IS NULL OR candidate.valid_to > order_row.order_time)
    ORDER BY candidate.valid_from DESC LIMIT 1
  ) assignment ON true
)
UPDATE public.huaxin_orders order_row SET
  warehouse_assignment_id = assignment.assignment_id,
  odoo_warehouse_id_at_sale = assignment.odoo_warehouse_id,
  export_content_hash = encode(extensions.digest(jsonb_build_object(
    'state', order_row.order_state, 'status', order_row.status_code, 'time', order_row.order_time,
    'price', order_row.price, 'products', order_row.products, 'nums', order_row.nums,
    'product_name', order_row.product_name, 'currency', order_row.currency, 'time_zone', order_row.time_zone,
    'refund', order_row.refund_status, 'pay_type', order_row.pay_type_raw,
    'machine', order_row.machine_id, 'warehouse', assignment.odoo_warehouse_id, 'resolutions', '[]'::JSONB
  )::text, 'sha256'), 'hex')
FROM historical_assignments assignment WHERE assignment.order_id = order_row.id;

UPDATE public.huaxin_orders order_row SET export_content_hash = encode(extensions.digest(jsonb_build_object(
  'state', order_row.order_state, 'status', order_row.status_code, 'time', order_row.order_time,
  'price', order_row.price, 'products', order_row.products, 'nums', order_row.nums,
  'product_name', order_row.product_name, 'currency', order_row.currency, 'time_zone', order_row.time_zone,
  'refund', order_row.refund_status, 'pay_type', order_row.pay_type_raw,
  'machine', order_row.machine_id, 'warehouse', order_row.odoo_warehouse_id_at_sale, 'resolutions', '[]'::JSONB
)::text, 'sha256'), 'hex') WHERE export_content_hash IS NULL;

CREATE OR REPLACE FUNCTION public.compute_order_export_hash(p_order public.huaxin_orders)
RETURNS TEXT LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_resolutions JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'line_index', line_index, 'product_id', platform_product_id, 'recipe_id', recipe_id,
    'recipe_version_id', recipe_version_id, 'method', mapping_method, 'status', resolution_status,
    'problem', problem_code) ORDER BY line_index), '[]'::JSONB)
  INTO v_resolutions FROM public.order_product_resolutions WHERE order_id = p_order.id;
  RETURN encode(extensions.digest(jsonb_build_object(
    'state', p_order.order_state, 'status', p_order.status_code, 'time', p_order.order_time,
    'price', p_order.price, 'products', p_order.products, 'nums', p_order.nums,
    'product_name', p_order.product_name, 'currency', p_order.currency, 'time_zone', p_order.time_zone,
    'refund', p_order.refund_status, 'pay_type', p_order.pay_type_raw,
    'machine', p_order.machine_id, 'warehouse', p_order.odoo_warehouse_id_at_sale,
    'resolutions', v_resolutions
  )::TEXT, 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_order_export_metadata()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_assignment public.machine_warehouse_assignments%ROWTYPE; v_hash TEXT;
BEGIN
  SELECT * INTO v_assignment FROM public.machine_warehouse_assignments assignment
  WHERE assignment.machine_id = NEW.machine_id AND assignment.valid_from <= NEW.order_time
    AND (assignment.valid_to IS NULL OR assignment.valid_to > NEW.order_time)
  ORDER BY assignment.valid_from DESC LIMIT 1;
  NEW.warehouse_assignment_id := v_assignment.id;
  NEW.odoo_warehouse_id_at_sale := v_assignment.odoo_warehouse_id;
  v_hash := public.compute_order_export_hash(NEW);
  IF TG_OP = 'INSERT' THEN
    NEW.export_version := 1; NEW.export_updated_at := now();
  ELSIF v_hash IS DISTINCT FROM OLD.export_content_hash THEN
    NEW.export_version := OLD.export_version + 1; NEW.export_updated_at := now();
  END IF;
  NEW.export_content_hash := v_hash;
  RETURN NEW;
END;
$$;
CREATE TRIGGER huaxin_orders_set_export_metadata
BEFORE INSERT OR UPDATE OF order_state, status_code, order_time, price, products, product_name, nums, refund_status, pay_type_raw, machine_id, currency, time_zone
ON public.huaxin_orders FOR EACH ROW EXECUTE FUNCTION public.set_order_export_metadata();
CREATE INDEX huaxin_orders_export_cursor_idx ON public.huaxin_orders(export_updated_at, id);

CREATE OR REPLACE FUNCTION public.is_manufacturing_order_eligible(order_row public.huaxin_orders)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT upper(COALESCE(order_row.order_state, '')) IN ('3', 'COMPLETE')
    AND COALESCE(order_row.pay_type_raw, '') NOT IN ('自动制作', 'Admin override')
    AND lower(COALESCE(order_row.refund_status, '')) NOT IN ('1', 'refunded')
    AND order_row.nums > 0 AND order_row.nums = trunc(order_row.nums)
$$;

CREATE TABLE public.order_product_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  raw_name TEXT,
  normalized_name TEXT,
  raw_position TEXT,
  menu_kind TEXT CHECK (menu_kind IS NULL OR menu_kind IN ('diy', 'unify')),
  platform_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
  recipe_version_id UUID REFERENCES public.recipe_versions(id) ON DELETE SET NULL,
  mapping_method TEXT NOT NULL CHECK (mapping_method IN ('menu_recipe_assignment', 'historical_hopper_assignment', 'canonical_ingredient_name', 'ingredient_alias', 'manual', 'unresolved', 'ignored')),
  resolution_status TEXT NOT NULL CHECK (resolution_status IN ('pending', 'resolved', 'ignored')),
  problem_code TEXT,
  resolution_note TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_index)
);
CREATE INDEX order_product_resolutions_pending_idx ON public.order_product_resolutions(normalized_name, order_id) WHERE resolution_status = 'pending';
CREATE TRIGGER order_product_resolutions_set_updated_at BEFORE UPDATE ON public.order_product_resolutions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.refresh_order_export_after_resolution()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_order_id UUID; v_order public.huaxin_orders%ROWTYPE; v_hash TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.raw_name, OLD.normalized_name, OLD.raw_position, OLD.menu_kind,
    OLD.platform_product_id, OLD.recipe_id, OLD.recipe_version_id, OLD.mapping_method, OLD.resolution_status, OLD.problem_code)
    IS NOT DISTINCT FROM ROW(NEW.raw_name, NEW.normalized_name, NEW.raw_position, NEW.menu_kind,
    NEW.platform_product_id, NEW.recipe_id, NEW.recipe_version_id, NEW.mapping_method, NEW.resolution_status, NEW.problem_code) THEN
    RETURN NEW;
  END IF;
  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT * INTO v_order FROM public.huaxin_orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  v_hash := public.compute_order_export_hash(v_order);
  UPDATE public.huaxin_orders SET export_version = export_version + 1, export_updated_at = now(), export_content_hash = v_hash
    WHERE id = v_order_id AND export_content_hash IS DISTINCT FROM v_hash;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER order_product_resolutions_refresh_export AFTER INSERT OR UPDATE OR DELETE ON public.order_product_resolutions
FOR EACH ROW EXECUTE FUNCTION public.refresh_order_export_after_resolution();

CREATE TABLE public.manufacturing_period_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('odoo', 'platform')),
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL,
  document_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'preparing', 'blocked', 'ready', 'processing', 'completed', 'failed', 'cancelled')),
  consumption_config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB,
  payload_sha256 TEXT,
  blocked_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  odoo_result JSONB,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to > period_from)
);
CREATE INDEX manufacturing_period_exports_cursor_idx ON public.manufacturing_period_exports(updated_at, id);
CREATE TRIGGER manufacturing_period_exports_set_updated_at BEFORE UPDATE ON public.manufacturing_period_exports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.manufacturing_period_export_orders (
  export_id UUID NOT NULL REFERENCES public.manufacturing_period_exports(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  export_version BIGINT NOT NULL,
  export_content_hash TEXT NOT NULL,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (export_id, order_id)
);
CREATE UNIQUE INDEX manufacturing_period_export_orders_active_idx ON public.manufacturing_period_export_orders(order_id) WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION public.finalize_manufacturing_export(
  p_export_id UUID, p_expected_orders JSONB, p_payload JSONB, p_payload_sha256 TEXT,
  p_config_snapshot JSONB, p_blocked_reasons JSONB
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_expected RECORD; v_order public.huaxin_orders%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_expected_orders) <> 'array' OR jsonb_typeof(p_blocked_reasons) <> 'array' THEN
    RAISE EXCEPTION 'Expected orders and blocked reasons must be arrays';
  END IF;
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.status NOT IN ('preparing', 'blocked', 'failed') THEN RAISE EXCEPTION 'Manufacturing export cannot be rebuilt from status %', v_export.status; END IF;
  FOR v_expected IN
    SELECT * FROM jsonb_to_recordset(p_expected_orders) AS item(order_id UUID, export_version BIGINT, export_content_hash TEXT)
    ORDER BY item.order_id
  LOOP
    SELECT * INTO v_order FROM public.huaxin_orders WHERE id = v_expected.order_id FOR UPDATE;
    IF NOT FOUND OR v_order.export_version <> v_expected.export_version
      OR v_order.export_content_hash IS DISTINCT FROM v_expected.export_content_hash THEN
      RAISE EXCEPTION 'Order changed during manufacturing preparation' USING ERRCODE = 'P0003';
    END IF;
    IF EXISTS (SELECT 1 FROM public.manufacturing_period_export_orders membership
      WHERE membership.order_id = v_expected.order_id AND membership.export_id <> p_export_id AND membership.released_at IS NULL) THEN
      RAISE EXCEPTION 'Order already belongs to another production run' USING ERRCODE = 'P0004';
    END IF;
  END LOOP;
  DELETE FROM public.manufacturing_period_export_orders WHERE export_id = p_export_id;
  INSERT INTO public.manufacturing_period_export_orders(export_id, order_id, export_version, export_content_hash)
  SELECT p_export_id, item.order_id, item.export_version, item.export_content_hash
  FROM jsonb_to_recordset(p_expected_orders) AS item(order_id UUID, export_version BIGINT, export_content_hash TEXT);
  UPDATE public.manufacturing_period_exports SET
    status = CASE WHEN jsonb_array_length(p_blocked_reasons) > 0 THEN 'blocked' ELSE 'draft' END,
    consumption_config_snapshot = p_config_snapshot,
    payload = CASE WHEN jsonb_array_length(p_blocked_reasons) > 0 THEN NULL ELSE p_payload END,
    payload_sha256 = CASE WHEN jsonb_array_length(p_blocked_reasons) > 0 THEN NULL ELSE p_payload_sha256 END,
    blocked_reasons = p_blocked_reasons
  WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_manufacturing_export(
  p_export_id UUID, p_payload_sha256 TEXT, p_caller TEXT
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.initiated_by <> p_caller THEN RAISE EXCEPTION 'Only the initiating system can confirm this run' USING ERRCODE = 'P0005'; END IF;
  IF v_export.status = 'ready' AND v_export.payload_sha256 = p_payload_sha256 THEN RETURN v_export; END IF;
  IF v_export.status <> 'draft' THEN RAISE EXCEPTION 'Only an unblocked draft can be confirmed' USING ERRCODE = 'P0001'; END IF;
  IF v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'Preview payload hash is stale' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.manufacturing_period_export_orders membership
    JOIN public.huaxin_orders order_row ON order_row.id = membership.order_id
    WHERE membership.export_id = p_export_id
      AND (membership.export_version <> order_row.export_version OR membership.export_content_hash IS DISTINCT FROM order_row.export_content_hash)
  ) THEN RAISE EXCEPTION 'An order changed after preview; prepare the run again' USING ERRCODE = 'P0003'; END IF;
  UPDATE public.manufacturing_period_exports SET status = 'ready', confirmed_at = now()
    WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_manufacturing_export_result(
  p_export_id UUID, p_payload_sha256 TEXT, p_result JSONB
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_accepted BOOLEAN;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'Result payload hash does not match the frozen run' USING ERRCODE = 'P0002'; END IF;
  IF v_export.odoo_result IS NOT NULL THEN
    IF v_export.odoo_result = p_result THEN RETURN v_export; END IF;
    IF v_export.status = 'failed' AND COALESCE((v_export.odoo_result->>'accepted')::BOOLEAN, false) = false
      AND COALESCE((p_result->>'accepted')::BOOLEAN, false) = true THEN
      UPDATE public.manufacturing_period_exports SET status = 'completed', odoo_result = p_result, completed_at = now()
        WHERE id = p_export_id RETURNING * INTO v_export;
      RETURN v_export;
    END IF;
    RAISE EXCEPTION 'A different result is already recorded' USING ERRCODE = 'P0001';
  END IF;
  IF v_export.status NOT IN ('ready', 'processing') THEN RAISE EXCEPTION 'Run is not ready for an Odoo result' USING ERRCODE = 'P0001'; END IF;
  v_accepted := COALESCE((p_result->>'accepted')::BOOLEAN, false);
  UPDATE public.manufacturing_period_exports SET status = CASE WHEN v_accepted THEN 'completed' ELSE 'failed' END,
    odoo_result = p_result, completed_at = now() WHERE id = p_export_id RETURNING * INTO v_export;
  RETURN v_export;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_frozen_manufacturing_export()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.confirmed_at IS NOT NULL AND (
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by OR NEW.period_from IS DISTINCT FROM OLD.period_from
    OR NEW.period_to IS DISTINCT FROM OLD.period_to OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
    OR NEW.document_date IS DISTINCT FROM OLD.document_date OR NEW.consumption_config_snapshot IS DISTINCT FROM OLD.consumption_config_snapshot
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
    OR NEW.blocked_reasons IS DISTINCT FROM OLD.blocked_reasons
  ) THEN RAISE EXCEPTION 'Confirmed manufacturing exports are immutable'; END IF;
  IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN RAISE EXCEPTION 'Completed manufacturing exports cannot be reopened'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER manufacturing_period_exports_protect_frozen BEFORE UPDATE ON public.manufacturing_period_exports
FOR EACH ROW EXECUTE FUNCTION public.protect_frozen_manufacturing_export();

CREATE OR REPLACE FUNCTION public.protect_frozen_export_membership()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_export_id UUID; v_confirmed_at TIMESTAMPTZ;
BEGIN
  v_export_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.export_id ELSE OLD.export_id END;
  SELECT confirmed_at INTO v_confirmed_at FROM public.manufacturing_period_exports WHERE id = v_export_id;
  IF v_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Confirmed manufacturing export membership is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER manufacturing_period_export_orders_protect_frozen
BEFORE INSERT OR UPDATE OR DELETE ON public.manufacturing_period_export_orders
FOR EACH ROW EXECUTE FUNCTION public.protect_frozen_export_membership();

ALTER TABLE public.production_consumption_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_product_consumption_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_product_consumption_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_version_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_menu_recipe_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_recipe_push_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_product_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_period_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_period_export_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.production_consumption_defaults, public.production_product_consumption_overrides,
  public.machine_product_consumption_overrides, public.production_settings, public.recipes, public.recipe_components,
  public.recipe_versions, public.recipe_version_components, public.machine_menu_recipe_assignments,
  public.menu_recipe_push_operations,
  public.order_product_resolutions, public.manufacturing_period_exports, public.manufacturing_period_export_orders
FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.create_or_reuse_recipe(UUID[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_or_reuse_recipe_version(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_recipe_odoo_result(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_manufacturing_export(UUID, JSONB, JSONB, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_manufacturing_export(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_manufacturing_export_result(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_menu_recipe_assignment(UUID, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_menu_recipe_assignments(UUID, JSONB, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_menu_recipe_push(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_reuse_recipe(UUID[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_or_reuse_recipe_version(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_recipe_odoo_result(UUID, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_manufacturing_export(UUID, JSONB, JSONB, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_manufacturing_export(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_manufacturing_export_result(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_menu_recipe_assignment(UUID, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_menu_recipe_assignments(UUID, JSONB, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_menu_recipe_push(UUID, TIMESTAMPTZ) TO service_role;
