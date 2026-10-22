BEGIN;

DO $$
DECLARE
  v_details JSONB := jsonb_build_object(
    'legal_name', 'María Ñandú SL',
    'tax_id', 'BÑ123',
    'email', 'facturación@example.com',
    'address', 'Calle Alcalá 42',
    'postal_code', '28014',
    'city', 'A Coruña',
    'province', 'Cataluña',
    'country_code', 'ES'
  );
  v_expected CONSTANT TEXT := '194074b5ce5a6bd18c7436fb1d15418afe4529e3b73a8e564fef0d633b5d301e';
  v_actual TEXT;
BEGIN
  v_actual := encode(extensions.digest(
    convert_to(public.canonical_jsonb_text(v_details), 'UTF8'), 'sha256'), 'hex');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Customer fiscal-details Unicode hash mismatch: expected %, got %', v_expected, v_actual;
  END IF;
END;
$$;

ROLLBACK;
