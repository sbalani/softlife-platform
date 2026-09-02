CREATE OR REPLACE FUNCTION public.canonical_production_uom(p_uom TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(p_uom))
    WHEN 'unit' THEN 'unit' WHEN 'units' THEN 'unit' WHEN 'u' THEN 'unit' WHEN 'each' THEN 'unit'
    WHEN 'g' THEN 'g' WHEN 'gram' THEN 'g' WHEN 'grams' THEN 'g'
    WHEN 'kg' THEN 'kg' WHEN 'kilogram' THEN 'kg' WHEN 'kilograms' THEN 'kg'
    WHEN 'ml' THEN 'ml' WHEN 'milliliter' THEN 'ml' WHEN 'milliliters' THEN 'ml'
    WHEN 'millilitre' THEN 'ml' WHEN 'millilitres' THEN 'ml'
    WHEN 'l' THEN 'l' WHEN 'liter' THEN 'l' WHEN 'liters' THEN 'l'
    WHEN 'litre' THEN 'l' WHEN 'litres' THEN 'l'
    ELSE NULL
  END
$$;
