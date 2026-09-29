ALTER TABLE public.odoo_sync_requests
  DROP CONSTRAINT odoo_sync_requests_kind_check,
  ADD CONSTRAINT odoo_sync_requests_kind_check
    CHECK (kind IN ('stock_snapshot', 'fiscal_product_remediation')),
  ADD COLUMN payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  ADD COLUMN payload_sha256 TEXT CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT odoo_sync_requests_fiscal_payload_check CHECK (
    (kind = 'stock_snapshot' AND payload = '{}'::jsonb AND payload_sha256 IS NULL)
    OR (
      kind = 'fiscal_product_remediation'
      AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1'
      AND jsonb_typeof(payload->'products') = 'array'
      AND payload_sha256 IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_odoo_sync_request_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256 THEN
    RAISE EXCEPTION 'Odoo sync request source fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER odoo_sync_requests_source_immutable
BEFORE UPDATE ON public.odoo_sync_requests
FOR EACH ROW EXECUTE FUNCTION public.prevent_odoo_sync_request_source_mutation();

REVOKE ALL ON FUNCTION public.prevent_odoo_sync_request_source_mutation() FROM PUBLIC, anon, authenticated;
