CREATE OR REPLACE FUNCTION public.validate_recipe_version_stock_conversion()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_mirror public.odoo_products%ROWTYPE;
  v_portion_category TEXT;
  v_portion_factor NUMERIC;
  v_stock_category TEXT;
  v_stock_factor NUMERIC;
  v_stock_uom TEXT;
  v_package_category TEXT;
  v_package_factor NUMERIC;
  v_package_uom TEXT;
  v_expected NUMERIC;
BEGIN
  -- Legacy recipe RPCs intentionally leave the additive stock snapshot empty.
  IF NEW.stock_quantity IS NULL AND NEW.stock_uom IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_mirror FROM public.odoo_products WHERE odoo_id = NEW.odoo_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Frozen Odoo ingredient is not present in the mirror'; END IF;

  v_portion_category := CASE lower(btrim(NEW.uom))
    WHEN 'g' THEN 'weight' WHEN 'gram' THEN 'weight' WHEN 'grams' THEN 'weight'
    WHEN 'kg' THEN 'weight' WHEN 'kilogram' THEN 'weight' WHEN 'kilograms' THEN 'weight'
    WHEN 'ml' THEN 'volume' WHEN 'milliliter' THEN 'volume' WHEN 'milliliters' THEN 'volume'
    WHEN 'millilitre' THEN 'volume' WHEN 'millilitres' THEN 'volume'
    WHEN 'l' THEN 'volume' WHEN 'liter' THEN 'volume' WHEN 'liters' THEN 'volume'
    WHEN 'litre' THEN 'volume' WHEN 'litres' THEN 'volume'
    WHEN 'unit' THEN 'unit' WHEN 'units' THEN 'unit' WHEN 'u' THEN 'unit' WHEN 'each' THEN 'unit'
  END;
  v_portion_factor := CASE lower(btrim(NEW.uom))
    WHEN 'kg' THEN 1000 WHEN 'kilogram' THEN 1000 WHEN 'kilograms' THEN 1000
    WHEN 'l' THEN 1000 WHEN 'liter' THEN 1000 WHEN 'liters' THEN 1000 WHEN 'litre' THEN 1000 WHEN 'litres' THEN 1000
    ELSE 1
  END;

  v_stock_category := CASE lower(btrim(v_mirror.uom))
    WHEN 'g' THEN 'weight' WHEN 'gram' THEN 'weight' WHEN 'grams' THEN 'weight'
    WHEN 'kg' THEN 'weight' WHEN 'kilogram' THEN 'weight' WHEN 'kilograms' THEN 'weight'
    WHEN 'ml' THEN 'volume' WHEN 'milliliter' THEN 'volume' WHEN 'milliliters' THEN 'volume'
    WHEN 'millilitre' THEN 'volume' WHEN 'millilitres' THEN 'volume'
    WHEN 'l' THEN 'volume' WHEN 'liter' THEN 'volume' WHEN 'liters' THEN 'volume'
    WHEN 'litre' THEN 'volume' WHEN 'litres' THEN 'volume'
    WHEN 'unit' THEN 'unit' WHEN 'units' THEN 'unit' WHEN 'u' THEN 'unit' WHEN 'each' THEN 'unit'
  END;
  v_stock_factor := CASE lower(btrim(v_mirror.uom))
    WHEN 'kg' THEN 1000 WHEN 'kilogram' THEN 1000 WHEN 'kilograms' THEN 1000
    WHEN 'l' THEN 1000 WHEN 'liter' THEN 1000 WHEN 'liters' THEN 1000 WHEN 'litre' THEN 1000 WHEN 'litres' THEN 1000
    ELSE 1
  END;
  v_stock_uom := CASE v_stock_category
    WHEN 'unit' THEN 'unit'
    WHEN 'weight' THEN CASE WHEN v_stock_factor = 1000 THEN 'kg' ELSE 'g' END
    WHEN 'volume' THEN CASE WHEN v_stock_factor = 1000 THEN 'l' ELSE 'ml' END
  END;

  IF v_portion_category IS NULL OR v_stock_category IS NULL OR lower(btrim(NEW.stock_uom)) IS DISTINCT FROM v_stock_uom THEN
    RAISE EXCEPTION 'Unsupported or inconsistent frozen stock UoM';
  END IF;

  IF v_portion_category = v_stock_category THEN
    IF NEW.package_content_quantity IS NOT NULL OR NEW.package_content_uom IS NOT NULL THEN
      RAISE EXCEPTION 'Compatible stock UoMs must not freeze a package conversion';
    END IF;
    v_expected := NEW.quantity * v_portion_factor / v_stock_factor;
  ELSIF v_stock_category = 'unit' THEN
    IF NEW.package_content_quantity IS NULL OR NEW.package_content_uom IS NULL
      OR v_mirror.package_content_quantity IS DISTINCT FROM NEW.package_content_quantity
      OR lower(btrim(v_mirror.package_content_uom)) IS DISTINCT FROM lower(btrim(NEW.package_content_uom)) THEN
      RAISE EXCEPTION 'Frozen package content does not match the authoritative Odoo mirror';
    END IF;
    v_package_category := CASE lower(btrim(NEW.package_content_uom))
      WHEN 'g' THEN 'weight' WHEN 'gram' THEN 'weight' WHEN 'grams' THEN 'weight'
      WHEN 'kg' THEN 'weight' WHEN 'kilogram' THEN 'weight' WHEN 'kilograms' THEN 'weight'
      WHEN 'ml' THEN 'volume' WHEN 'milliliter' THEN 'volume' WHEN 'milliliters' THEN 'volume'
      WHEN 'millilitre' THEN 'volume' WHEN 'millilitres' THEN 'volume'
      WHEN 'l' THEN 'volume' WHEN 'liter' THEN 'volume' WHEN 'liters' THEN 'volume'
      WHEN 'litre' THEN 'volume' WHEN 'litres' THEN 'volume'
    END;
    v_package_factor := CASE lower(btrim(NEW.package_content_uom))
      WHEN 'kg' THEN 1000 WHEN 'kilogram' THEN 1000 WHEN 'kilograms' THEN 1000
      WHEN 'l' THEN 1000 WHEN 'liter' THEN 1000 WHEN 'liters' THEN 1000 WHEN 'litre' THEN 1000 WHEN 'litres' THEN 1000
      ELSE 1
    END;
    v_package_uom := CASE v_package_category
      WHEN 'weight' THEN CASE WHEN v_package_factor = 1000 THEN 'kg' ELSE 'g' END
      WHEN 'volume' THEN CASE WHEN v_package_factor = 1000 THEN 'l' ELSE 'ml' END
    END;
    IF v_package_category IS DISTINCT FROM v_portion_category OR lower(btrim(NEW.package_content_uom)) IS DISTINCT FROM v_package_uom THEN
      RAISE EXCEPTION 'Frozen package content UoM is incompatible or non-canonical';
    END IF;
    v_expected := NEW.quantity * v_portion_factor / (NEW.package_content_quantity * v_package_factor);
  ELSE
    RAISE EXCEPTION 'Physical portion is incompatible with Odoo stock UoM';
  END IF;

  IF abs(NEW.stock_quantity - v_expected) > 0.000000000001 THEN
    RAISE EXCEPTION 'Frozen stock quantity does not match physical dosage and package content';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recipe_version_components_validate_stock_conversion
BEFORE INSERT ON public.recipe_version_components
FOR EACH ROW EXECUTE FUNCTION public.validate_recipe_version_stock_conversion();

-- Odoo owns package metadata, but the catalog cursor is based on the linked
-- platform product timestamp. Advance it whenever conversion inputs change.
CREATE OR REPLACE FUNCTION public.touch_products_for_odoo_conversion()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.uom IS DISTINCT FROM OLD.uom
    OR NEW.package_content_quantity IS DISTINCT FROM OLD.package_content_quantity
    OR NEW.package_content_uom IS DISTINCT FROM OLD.package_content_uom THEN
    UPDATE public.products SET updated_at = now() WHERE odoo_id = NEW.odoo_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER odoo_products_touch_conversion_catalog
AFTER INSERT OR UPDATE OF uom, package_content_quantity, package_content_uom ON public.odoo_products
FOR EACH ROW EXECUTE FUNCTION public.touch_products_for_odoo_conversion();
