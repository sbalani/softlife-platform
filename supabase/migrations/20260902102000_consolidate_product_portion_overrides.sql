-- Preserve current manufacturing behavior: an existing production override wins,
-- while legacy ingredient-only portions become rows in the same canonical table.
BEGIN;

LOCK TABLE public.production_product_consumption_overrides IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.products product SET
  default_portion_size = override_row.quantity,
  default_portion_uom = override_row.uom
FROM public.production_product_consumption_overrides override_row
WHERE product.id = override_row.product_id
  AND ROW(product.default_portion_size, product.default_portion_uom)
    IS DISTINCT FROM ROW(override_row.quantity, override_row.uom);

INSERT INTO public.production_product_consumption_overrides(product_id, quantity, uom)
SELECT product.id, product.default_portion_size, product.default_portion_uom
FROM public.products product
WHERE product.default_portion_size IS NOT NULL
ON CONFLICT (product_id) DO NOTHING;

CREATE FUNCTION public.set_product_consumption_override(
  p_product_id UUID,
  p_consumption_type TEXT,
  p_set_consumption_type BOOLEAN,
  p_quantity NUMERIC,
  p_uom TEXT,
  p_expected_quantity NUMERIC,
  p_expected_uom TEXT,
  p_check_expected BOOLEAN DEFAULT true
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current public.production_product_consumption_overrides%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_has_override BOOLEAN;
  v_current_quantity NUMERIC;
  v_current_uom TEXT;
BEGIN
  IF p_set_consumption_type AND p_consumption_type IS NOT NULL AND p_consumption_type NOT IN ('base', 'solid_topping', 'liquid_topping') THEN
    RAISE EXCEPTION 'Invalid consumption type';
  END IF;
  IF (p_quantity IS NULL) <> (p_uom IS NULL) OR p_quantity IS NOT NULL AND (p_quantity <= 0 OR NULLIF(btrim(p_uom), '') IS NULL) THEN
    RAISE EXCEPTION 'Quantity and UoM must both be set or both be empty';
  END IF;
  IF (p_expected_quantity IS NULL) <> (p_expected_uom IS NULL) THEN
    RAISE EXCEPTION 'Invalid expected portion';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_product_id::TEXT, 0));
  SELECT * INTO v_current FROM public.production_product_consumption_overrides
  WHERE product_id = p_product_id FOR UPDATE;
  v_has_override := FOUND;
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ingredient not found'; END IF;
  v_current_quantity := CASE WHEN v_has_override THEN v_current.quantity ELSE v_product.default_portion_size END;
  v_current_uom := CASE WHEN v_has_override THEN v_current.uom ELSE v_product.default_portion_uom END;
  IF p_check_expected
    AND ROW(v_current_quantity, v_current_uom) IS DISTINCT FROM ROW(p_expected_quantity, p_expected_uom)
    AND ROW(v_current_quantity, v_current_uom) IS DISTINCT FROM ROW(p_quantity, CASE WHEN p_uom IS NULL THEN NULL ELSE btrim(p_uom) END) THEN
    RAISE EXCEPTION 'The production portion changed on another screen. Refresh before changing it.' USING ERRCODE = 'P0001';
  END IF;

  IF p_quantity IS NULL THEN
    DELETE FROM public.production_product_consumption_overrides WHERE product_id = p_product_id;
  ELSE
    INSERT INTO public.production_product_consumption_overrides(product_id, quantity, uom)
    VALUES (p_product_id, p_quantity, btrim(p_uom))
      ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, uom = EXCLUDED.uom;
  END IF;
  UPDATE public.products SET
    default_portion_size = p_quantity,
    default_portion_uom = CASE WHEN p_uom IS NULL THEN NULL ELSE btrim(p_uom) END,
    consumption_type = CASE WHEN p_set_consumption_type THEN p_consumption_type ELSE consumption_type END
  WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_consumption_override(UUID, TEXT, BOOLEAN, NUMERIC, TEXT, NUMERIC, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_consumption_override(UUID, TEXT, BOOLEAN, NUMERIC, TEXT, NUMERIC, TEXT, BOOLEAN)
  TO service_role;

COMMIT;
