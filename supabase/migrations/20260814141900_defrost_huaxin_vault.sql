CREATE OR REPLACE FUNCTION public.configure_defrost_huaxin_config(
  p_base_url TEXT,
  p_mch_id TEXT,
  p_mch_secret TEXT,
  p_sign TEXT,
  p_nonce_str TEXT,
  p_time_stamp TEXT,
  p_notify_url TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault
AS $$
DECLARE
  item RECORD;
BEGIN
  IF COALESCE(p_base_url, '') = '' OR COALESCE(p_mch_id, '') = '' OR COALESCE(p_mch_secret, '') = '' OR COALESCE(p_sign, '') = '' THEN
    RAISE EXCEPTION 'Required Huaxin configuration is missing';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('softlife_huaxin_base_url', p_base_url),
    ('softlife_huaxin_mch_id', p_mch_id),
    ('softlife_huaxin_mch_secret', p_mch_secret),
    ('softlife_huaxin_sign', p_sign),
    ('softlife_huaxin_nonce_str', COALESCE(p_nonce_str, '')),
    ('softlife_huaxin_time_stamp', COALESCE(p_time_stamp, '')),
    ('softlife_huaxin_notify_url', COALESCE(p_notify_url, ''))
  ) AS values_to_store(name, secret)
  LOOP
    DELETE FROM vault.secrets WHERE name = item.name;
    PERFORM vault.create_secret(item.secret, item.name, 'Huaxin configuration used by the Supabase defrost worker');
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_defrost_huaxin_config()
RETURNS TABLE (
  base_url TEXT,
  mch_id TEXT,
  mch_secret TEXT,
  sign TEXT,
  nonce_str TEXT,
  time_stamp TEXT,
  notify_url TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault
AS $$
  SELECT
    MAX(decrypted_secret) FILTER (WHERE name = 'softlife_huaxin_base_url'),
    MAX(decrypted_secret) FILTER (WHERE name = 'softlife_huaxin_mch_id'),
    MAX(decrypted_secret) FILTER (WHERE name = 'softlife_huaxin_mch_secret'),
    MAX(decrypted_secret) FILTER (WHERE name = 'softlife_huaxin_sign'),
    COALESCE(MAX(decrypted_secret) FILTER (WHERE name = 'softlife_huaxin_nonce_str'), ''),
    COALESCE(MAX(decrypted_secret) FILTER (WHERE name = 'softlife_huaxin_time_stamp'), ''),
    COALESCE(MAX(decrypted_secret) FILTER (WHERE name = 'softlife_huaxin_notify_url'), '')
  FROM vault.decrypted_secrets;
$$;

REVOKE ALL ON FUNCTION public.configure_defrost_huaxin_config(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_defrost_huaxin_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_defrost_huaxin_config(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_defrost_huaxin_config() TO service_role;
