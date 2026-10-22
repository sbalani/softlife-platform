-- Expand-only platform contract for Madrid-local transactions from 2026-09-01.

CREATE OR REPLACE FUNCTION public.canonical_jsonb_text(p_value JSONB)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'object' THEN '{' || COALESCE((
      SELECT string_agg(to_jsonb(entry.key)::text || ':' || public.canonical_jsonb_text(entry.value), ',' ORDER BY entry.key)
      FROM jsonb_each(p_value) entry
    ), '') || '}'
    WHEN 'array' THEN '[' || COALESCE((
      SELECT string_agg(public.canonical_jsonb_text(entry.value), ',' ORDER BY entry.ordinality)
      FROM jsonb_array_elements(p_value) WITH ORDINALITY entry(value, ordinality)
    ), '') || ']'
    ELSE p_value::text
  END
$$;

CREATE TABLE public.customer_invoice_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status = 'accepted'),
  fiscal_details JSONB NOT NULL CHECK (
    jsonb_typeof(fiscal_details) = 'object'
    AND NULLIF(btrim(fiscal_details->>'legal_name'), '') IS NOT NULL
    AND char_length(fiscal_details->>'legal_name') <= 200
    AND NULLIF(btrim(fiscal_details->>'tax_id'), '') IS NOT NULL
    AND char_length(fiscal_details->>'tax_id') <= 50
    AND fiscal_details->>'tax_id' = upper(fiscal_details->>'tax_id')
    AND NULLIF(btrim(fiscal_details->>'email'), '') IS NOT NULL
    AND char_length(fiscal_details->>'email') <= 254
    AND fiscal_details->>'email' = lower(fiscal_details->>'email')
    AND fiscal_details->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND NULLIF(btrim(fiscal_details->>'address'), '') IS NOT NULL
    AND char_length(fiscal_details->>'address') <= 300
    AND NULLIF(btrim(fiscal_details->>'postal_code'), '') IS NOT NULL
    AND char_length(fiscal_details->>'postal_code') <= 20
    AND NULLIF(btrim(fiscal_details->>'city'), '') IS NOT NULL
    AND char_length(fiscal_details->>'city') <= 100
    AND NULLIF(btrim(fiscal_details->>'province'), '') IS NOT NULL
    AND char_length(fiscal_details->>'province') <= 100
    AND fiscal_details->>'country_code' ~ '^[A-Z]{2}$'
    AND fiscal_details = jsonb_build_object(
      'legal_name', btrim(fiscal_details->>'legal_name'),
      'tax_id', btrim(fiscal_details->>'tax_id'),
      'email', btrim(fiscal_details->>'email'),
      'address', btrim(fiscal_details->>'address'),
      'postal_code', btrim(fiscal_details->>'postal_code'),
      'city', btrim(fiscal_details->>'city'),
      'province', btrim(fiscal_details->>'province'),
      'country_code', btrim(fiscal_details->>'country_code')
    )
  ),
  fiscal_details_sha256 TEXT NOT NULL CHECK (
    fiscal_details_sha256 ~ '^[0-9a-f]{64}$'
    AND fiscal_details_sha256 = encode(extensions.digest(
      convert_to(public.canonical_jsonb_text(fiscal_details), 'UTF8'), 'sha256'), 'hex')
  ),
  accepted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_order_id)
);

CREATE INDEX customer_invoice_requests_created_idx ON public.customer_invoice_requests(created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_customer_invoice_request_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Accepted customer invoice requests are immutable';
END;
$$;

CREATE TRIGGER customer_invoice_requests_immutable
BEFORE UPDATE OR DELETE ON public.customer_invoice_requests
FOR EACH ROW EXECUTE FUNCTION public.prevent_customer_invoice_request_mutation();

CREATE OR REPLACE FUNCTION public.record_customer_invoice_request(
  p_order_code TEXT, p_fiscal_details JSONB, p_actor_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.huaxin_orders%ROWTYPE; v_existing public.customer_invoice_requests%ROWTYPE;
  v_id UUID; v_hash TEXT; v_order_count INTEGER;
BEGIN
  IF NULLIF(btrim(p_order_code), '') IS NULL OR jsonb_typeof(p_fiscal_details) <> 'object' THEN
    RAISE EXCEPTION 'A source order and complete fiscal details are required';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'A valid recording actor is required';
  END IF;
  PERFORM id FROM public.huaxin_orders WHERE order_code = btrim(p_order_code) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_order_count FROM public.huaxin_orders WHERE order_code = btrim(p_order_code);
  IF v_order_count = 0 THEN RAISE EXCEPTION 'Source order not found'; END IF;
  IF v_order_count > 1 THEN RAISE EXCEPTION 'Source order code is ambiguous'; END IF;
  SELECT * INTO v_order FROM public.huaxin_orders WHERE order_code = btrim(p_order_code);
  IF v_order.order_time IS NULL OR (v_order.order_time AT TIME ZONE 'Europe/Madrid')::date < DATE '2026-09-01' THEN
    RAISE EXCEPTION 'Customer invoice requests apply only to post-cutover transactions';
  END IF;
  v_hash := encode(extensions.digest(convert_to(public.canonical_jsonb_text(p_fiscal_details), 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO v_existing FROM public.customer_invoice_requests WHERE source_order_id = v_order.id;
  IF FOUND THEN
    IF v_existing.fiscal_details = p_fiscal_details AND v_existing.fiscal_details_sha256 = v_hash THEN
      RETURN jsonb_build_object('request_id', v_existing.id, 'source_order_id', v_order.id,
        'fiscal_details_sha256', v_existing.fiscal_details_sha256, 'idempotent', true);
    END IF;
    RAISE EXCEPTION 'This source order already has a different accepted customer invoice request' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_preflight_items item
    JOIN public.fiscal_preflight_runs run ON run.id = item.run_id
    WHERE item.order_id = v_order.id AND run.contract_version = 2
  ) OR EXISTS (
    SELECT 1 FROM public.fiscal_invoice_source_allocations allocation
    WHERE allocation.source_order_id = v_order.id AND allocation.released_at IS NULL
  ) THEN RAISE EXCEPTION 'Record the customer invoice request before freezing its fiscal month'; END IF;
  INSERT INTO public.customer_invoice_requests(source_order_id, fiscal_details, fiscal_details_sha256, accepted_by)
  VALUES (v_order.id, p_fiscal_details, v_hash, p_actor_id) RETURNING id INTO v_id;
  RETURN jsonb_build_object('request_id', v_id, 'source_order_id', v_order.id,
    'fiscal_details_sha256', v_hash, 'idempotent', false);
END;
$$;

CREATE TABLE public.manufacturing_sale_order_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id UUID NOT NULL REFERENCES public.manufacturing_period_exports(id) ON DELETE RESTRICT,
  source_order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  platform_line_key TEXT NOT NULL CHECK (NULLIF(btrim(platform_line_key), '') IS NOT NULL),
  odoo_sale_order_id INTEGER NOT NULL CHECK (odoo_sale_order_id > 0),
  odoo_sale_order_line_id INTEGER NOT NULL CHECK (odoo_sale_order_line_id > 0),
  created_in_odoo BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_order_id),
  UNIQUE (export_id, source_order_id),
  UNIQUE (odoo_sale_order_id),
  UNIQUE (odoo_sale_order_line_id)
);

CREATE OR REPLACE FUNCTION public.prevent_manufacturing_sale_order_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Manufacturing sales-order mappings are immutable'; END;
$$;
CREATE TRIGGER manufacturing_sale_order_documents_immutable
BEFORE UPDATE OR DELETE ON public.manufacturing_sale_order_documents
FOR EACH ROW EXECUTE FUNCTION public.prevent_manufacturing_sale_order_mutation();

CREATE OR REPLACE FUNCTION public.record_manufacturing_export_result_v3(
  p_export_id UUID, p_payload_sha256 TEXT, p_result JSONB
)
RETURNS public.manufacturing_period_exports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_export public.manufacturing_period_exports%ROWTYPE; v_expected INTEGER; v_inserted INTEGER;
BEGIN
  SELECT * INTO v_export FROM public.manufacturing_period_exports WHERE id = p_export_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manufacturing export not found'; END IF;
  IF v_export.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION 'Result payload hash does not match the frozen run' USING ERRCODE = 'P0002';
  END IF;
  IF v_export.payload->>'manufacturing_contract_version' <> '3' THEN RAISE EXCEPTION 'Manufacturing contract v3 is required'; END IF;
  IF (v_export.payload->'connector_capabilities'->>'manufacturing_transaction_sales')::integer IS DISTINCT FROM 1
    OR (v_export.payload->'connector_capabilities'->>'fiscal_invoice_allocation_v2')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Frozen manufacturing v3 capabilities are invalid';
  END IF;
  IF octet_length(convert_to(public.canonical_jsonb_text(p_result), 'UTF8')) > 5000000 THEN
    RAISE EXCEPTION 'Manufacturing result exceeds 5000000 bytes';
  END IF;
  IF COALESCE((p_result->>'accepted')::boolean, false) = false THEN
    RETURN public.record_manufacturing_export_result(p_export_id, p_payload_sha256, p_result);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_export.payload->'warehouses') warehouse,
      jsonb_array_elements(warehouse->'recipes') recipe
    WHERE (recipe->>'gross_sales_cents')::bigint IS DISTINCT FROM (
      SELECT sum((sale->>'expected_total_cents')::bigint)
      FROM jsonb_array_elements(warehouse->'sales_orders') sale
      WHERE sale->>'recipe_version_id' = recipe->>'recipe_version_id'
    )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_export.payload->'warehouses') warehouse,
      jsonb_array_elements(warehouse->'sales_orders') sale
    WHERE NULLIF(sale->>'recipe_version_id', '') IS NULL
      OR (SELECT count(*) FROM jsonb_array_elements(warehouse->'recipes') recipe
        WHERE recipe->>'recipe_version_id' = sale->>'recipe_version_id') <> 1
  ) THEN RAISE EXCEPTION 'Manufacturing v3 recipe gross cents do not match per-order rounded sales'; END IF;
  IF v_export.odoo_result IS NOT NULL AND NOT (
    v_export.status = 'failed' AND COALESCE((v_export.odoo_result->>'accepted')::boolean, false) = false
      AND COALESCE((p_result->>'accepted')::boolean, false) = true
  ) THEN
    RETURN public.record_manufacturing_export_result(p_export_id, p_payload_sha256, p_result);
  END IF;
  SELECT count(*) INTO v_expected
  FROM jsonb_array_elements(v_export.payload->'warehouses') warehouse,
       jsonb_array_elements(warehouse->'sales_orders') sale;
  IF v_expected = 0 OR v_expected <> (
    SELECT count(*) FROM jsonb_array_elements(p_result->'warehouses') warehouse,
      jsonb_array_elements(warehouse->'sales_orders') sale
  ) OR v_expected <> (
    SELECT count(DISTINCT sale->>'platform_order_id')
    FROM jsonb_array_elements(p_result->'warehouses') warehouse,
      jsonb_array_elements(warehouse->'sales_orders') sale
  ) THEN RAISE EXCEPTION 'Transaction sales-order result coverage mismatch'; END IF;

  INSERT INTO public.manufacturing_sale_order_documents(
    export_id, source_order_id, source_sha256, platform_line_key,
    odoo_sale_order_id, odoo_sale_order_line_id, created_in_odoo
  )
  SELECT p_export_id, (received->>'platform_order_id')::uuid, received->>'source_sha256',
    received->>'platform_line_key', (received->>'odoo_sale_order_id')::integer,
    (received->>'odoo_sale_order_line_id')::integer, (received->>'created')::boolean
  FROM jsonb_array_elements(p_result->'warehouses') result_warehouse,
       jsonb_array_elements(result_warehouse->'sales_orders') received
  JOIN LATERAL (
    SELECT expected
    FROM jsonb_array_elements(v_export.payload->'warehouses') payload_warehouse,
         jsonb_array_elements(payload_warehouse->'sales_orders') expected
    WHERE payload_warehouse->>'odoo_warehouse_id' = result_warehouse->>'odoo_warehouse_id'
      AND expected->>'platform_order_id' = received->>'platform_order_id'
      AND expected->>'source_sha256' = received->>'source_sha256'
      AND expected->>'platform_line_key' = received->>'platform_line_key'
  ) matched ON true
  JOIN public.manufacturing_period_export_orders membership
    ON membership.export_id = p_export_id AND membership.order_id = (received->>'platform_order_id')::uuid
  WHERE (received->>'odoo_sale_order_id')::integer > 0
    AND (received->>'odoo_sale_order_line_id')::integer > 0
    AND jsonb_typeof(received->'created') = 'boolean';
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_expected THEN RAISE EXCEPTION 'Transaction sales-order result identity mismatch'; END IF;
  RETURN public.record_manufacturing_export_result(p_export_id, p_payload_sha256, p_result);
END;
$$;

ALTER TABLE public.fiscal_preflight_runs
  ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version IN (1, 2)),
  ADD COLUMN local_month TEXT CHECK (local_month IS NULL OR local_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

ALTER TABLE public.fiscal_preflight_items
  ADD COLUMN invoice_mode TEXT CHECK (invoice_mode IS NULL OR invoice_mode IN ('individual_requested', 'monthly_consolidated')),
  ADD COLUMN invoice_request_id UUID REFERENCES public.customer_invoice_requests(id) ON DELETE RESTRICT,
  ADD COLUMN customer_fiscal_details JSONB CHECK (customer_fiscal_details IS NULL OR jsonb_typeof(customer_fiscal_details) = 'object'),
  ADD COLUMN customer_fiscal_details_sha256 TEXT CHECK (customer_fiscal_details_sha256 IS NULL OR customer_fiscal_details_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN supporting_sale_order_id UUID REFERENCES public.manufacturing_sale_order_documents(id) ON DELETE RESTRICT,
  ADD COLUMN supporting_sale_order_source_sha256 TEXT CHECK (
    supporting_sale_order_source_sha256 IS NULL OR supporting_sale_order_source_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT fiscal_preflight_items_v2_snapshot_check CHECK (
    (invoice_mode IS NULL AND supporting_sale_order_id IS NULL AND supporting_sale_order_source_sha256 IS NULL)
    OR (invoice_mode IS NOT NULL AND supporting_sale_order_id IS NOT NULL
      AND supporting_sale_order_source_sha256 IS NOT NULL)
  ),
  ADD CONSTRAINT fiscal_preflight_items_request_snapshot_check CHECK (
    (invoice_mode = 'individual_requested' AND invoice_request_id IS NOT NULL
      AND customer_fiscal_details IS NOT NULL AND customer_fiscal_details_sha256 IS NOT NULL)
    OR (invoice_mode IS DISTINCT FROM 'individual_requested' AND invoice_request_id IS NULL
      AND customer_fiscal_details IS NULL AND customer_fiscal_details_sha256 IS NULL)
  );

ALTER TABLE public.fiscal_invoice_jobs
  ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version IN (1, 2)),
  ADD COLUMN local_month TEXT CHECK (local_month IS NULL OR local_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

ALTER TABLE public.fiscal_invoice_batches
  ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version IN (1, 2)),
  DROP CONSTRAINT fiscal_invoice_batches_payload_check,
  DROP CONSTRAINT fiscal_invoice_batches_payload_check1,
  ADD CONSTRAINT fiscal_invoice_batches_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND (payload->>'contract_version')::integer = contract_version
    AND contract_version IN (1, 2) AND jsonb_typeof(payload->'invoices') = 'array'
  );

ALTER TABLE public.fiscal_invoice_documents
  ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version IN (1, 2)),
  ADD COLUMN invoice_mode TEXT CHECK (invoice_mode IS NULL OR invoice_mode IN ('individual_requested', 'monthly_consolidated')),
  ADD COLUMN local_month TEXT CHECK (local_month IS NULL OR local_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD COLUMN invoice_request_id UUID REFERENCES public.customer_invoice_requests(id) ON DELETE RESTRICT,
  ADD COLUMN customer_fiscal_details JSONB CHECK (customer_fiscal_details IS NULL OR jsonb_typeof(customer_fiscal_details) = 'object'),
  ADD COLUMN customer_fiscal_details_sha256 TEXT CHECK (customer_fiscal_details_sha256 IS NULL OR customer_fiscal_details_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN released_at TIMESTAMPTZ,
  ALTER COLUMN preflight_item_id DROP NOT NULL,
  ALTER COLUMN source_order_id DROP NOT NULL,
  ALTER COLUMN source_sha256 DROP NOT NULL,
  ALTER COLUMN operation_at DROP NOT NULL,
  ALTER COLUMN order_code DROP NOT NULL,
  ALTER COLUMN odoo_product_id DROP NOT NULL,
  ADD CONSTRAINT fiscal_invoice_documents_version_shape_check CHECK (
    (contract_version = 1 AND preflight_item_id IS NOT NULL AND source_order_id IS NOT NULL
      AND source_sha256 IS NOT NULL AND invoice_mode IS NULL AND local_month IS NULL)
    OR (contract_version = 2 AND preflight_item_id IS NULL AND source_order_id IS NULL
      AND source_sha256 IS NULL AND invoice_mode IS NOT NULL AND local_month IS NOT NULL)
  );

CREATE UNIQUE INDEX fiscal_invoice_documents_active_monthly_consolidated_key
  ON public.fiscal_invoice_documents(local_month)
  WHERE contract_version = 2 AND invoice_mode = 'monthly_consolidated' AND released_at IS NULL;

ALTER TABLE public.fiscal_invoice_documents
  DROP CONSTRAINT fiscal_invoice_documents_zero_value_reason_check,
  ADD CONSTRAINT fiscal_invoice_documents_zero_value_reason_check CHECK (
    (contract_version = 1 AND (
      (gross_cents = 0 AND invoice_payload->>'zero_value_reason' IN ('free', 'admin_override', 'coupon'))
      OR (gross_cents > 0 AND invoice_payload->>'zero_value_reason' IS NULL)
    )) OR (contract_version = 2 AND gross_cents >= 0)
  );

CREATE OR REPLACE FUNCTION public.validate_fiscal_invoice_zero_value_source()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expected_reason TEXT; v_capability INTEGER;
BEGIN
  IF NEW.contract_version = 2 THEN RETURN NEW; END IF;
  SELECT CASE btrim(item.source_snapshot->>'pay_type_raw')
    WHEN '免费' THEN 'free' WHEN 'Free' THEN 'free'
    WHEN '自动制作' THEN 'admin_override' WHEN 'Admin override' THEN 'admin_override'
    WHEN '串码支付' THEN 'coupon' WHEN 'Coupon' THEN 'coupon' ELSE NULL END
  INTO v_expected_reason FROM public.fiscal_preflight_items item WHERE item.id = NEW.preflight_item_id;
  IF NOT FOUND OR NEW.invoice_payload->>'zero_value_reason' IS DISTINCT FROM v_expected_reason THEN
    RAISE EXCEPTION 'Fiscal invoice zero-value reason does not match its frozen source';
  END IF;
  IF v_expected_reason IS NOT NULL THEN
    SELECT (report.payload->'capabilities'->>'fiscal_zero_value_invoices')::integer INTO v_capability
    FROM public.fiscal_invoice_batches batch
    JOIN public.odoo_fiscal_configuration_reports report ON report.id = batch.configuration_report_id
    WHERE batch.id = NEW.batch_id;
    IF v_capability IS NULL OR v_capability < 1 OR (v_expected_reason = 'coupon' AND v_capability < 2) THEN
      RAISE EXCEPTION 'Odoo zero-value fiscal invoice capability is not supported for this payment type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.fiscal_invoice_source_allocations (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.fiscal_invoice_documents(id) ON DELETE RESTRICT,
  preflight_item_id UUID NOT NULL REFERENCES public.fiscal_preflight_items(id) ON DELETE RESTRICT,
  source_order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  invoice_request_id UUID REFERENCES public.customer_invoice_requests(id) ON DELETE RESTRICT,
  supporting_sale_order_id UUID NOT NULL REFERENCES public.manufacturing_sale_order_documents(id) ON DELETE RESTRICT,
  supporting_sale_order_source_sha256 TEXT NOT NULL CHECK (supporting_sale_order_source_sha256 ~ '^[0-9a-f]{64}$'),
  odoo_sale_order_id INTEGER NOT NULL CHECK (odoo_sale_order_id > 0),
  odoo_sale_order_line_id INTEGER NOT NULL CHECK (odoo_sale_order_line_id > 0),
  line_sequence INTEGER NOT NULL CHECK (line_sequence > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'draft', 'posted', 'released')),
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, line_sequence),
  UNIQUE (document_id, source_order_id)
);
CREATE UNIQUE INDEX fiscal_invoice_source_allocations_active_source_key
  ON public.fiscal_invoice_source_allocations(source_order_id) WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION public.protect_fiscal_invoice_allocation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Fiscal invoice allocations cannot be deleted'; END IF;
  IF NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.preflight_item_id IS DISTINCT FROM OLD.preflight_item_id
    OR NEW.source_order_id IS DISTINCT FROM OLD.source_order_id OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
    OR NEW.invoice_request_id IS DISTINCT FROM OLD.invoice_request_id
    OR NEW.supporting_sale_order_id IS DISTINCT FROM OLD.supporting_sale_order_id
    OR NEW.supporting_sale_order_source_sha256 IS DISTINCT FROM OLD.supporting_sale_order_source_sha256
    OR NEW.odoo_sale_order_id IS DISTINCT FROM OLD.odoo_sale_order_id
    OR NEW.odoo_sale_order_line_id IS DISTINCT FROM OLD.odoo_sale_order_line_id
    OR NEW.line_sequence IS DISTINCT FROM OLD.line_sequence OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Fiscal invoice allocation source fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fiscal_invoice_source_allocations_protected
BEFORE UPDATE OR DELETE ON public.fiscal_invoice_source_allocations
FOR EACH ROW EXECUTE FUNCTION public.protect_fiscal_invoice_allocation();

CREATE OR REPLACE FUNCTION public.sync_fiscal_invoice_allocation_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.contract_version = 2 THEN
    UPDATE public.fiscal_invoice_source_allocations SET status = CASE NEW.status
      WHEN 'draft' THEN 'draft' WHEN 'posted' THEN 'posted' ELSE status END
    WHERE document_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fiscal_invoice_documents_sync_allocations
AFTER UPDATE OF status ON public.fiscal_invoice_documents
FOR EACH ROW EXECUTE FUNCTION public.sync_fiscal_invoice_allocation_status();

CREATE OR REPLACE FUNCTION public.create_fiscal_preflight_v2(
  p_period_from TIMESTAMPTZ, p_period_to TIMESTAMPTZ, p_time_zone TEXT, p_tax_rate NUMERIC,
  p_currency TEXT, p_configuration_report_id UUID, p_settings_snapshot JSONB,
  p_global_findings JSONB, p_summary JSONB, p_requested_by UUID, p_items JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run_id UUID; v_status TEXT; v_item_count INTEGER; v_month TEXT;
BEGIN
  IF p_time_zone <> 'Europe/Madrid' OR p_period_to <= p_period_from OR p_period_to > now()
    OR (p_period_from AT TIME ZONE p_time_zone)::time <> TIME '00:00:00'
    OR extract(day FROM p_period_from AT TIME ZONE p_time_zone) <> 1
    OR (p_period_to AT TIME ZONE p_time_zone)::timestamp
      <> ((p_period_from AT TIME ZONE p_time_zone)::timestamp + interval '1 month')
    OR (p_period_from AT TIME ZONE p_time_zone)::date < DATE '2026-09-01' THEN
    RAISE EXCEPTION 'Fiscal v2 preflight requires one closed Europe/Madrid calendar month';
  END IF;
  IF jsonb_typeof(p_settings_snapshot) <> 'object' OR jsonb_typeof(p_global_findings) <> 'array'
    OR jsonb_typeof(p_summary) <> 'object' OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) > 100000 THEN RAISE EXCEPTION 'Invalid fiscal v2 preflight payload'; END IF;
  IF p_configuration_report_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.odoo_fiscal_configuration_reports WHERE id = p_configuration_report_id
  ) THEN RAISE EXCEPTION 'Fiscal configuration report not found'; END IF;
  PERFORM order_row.id
  FROM public.huaxin_orders order_row
  JOIN jsonb_array_elements(p_items) item ON order_row.id = (item->>'order_id')::uuid
  WHERE item->>'status' = 'eligible'
  ORDER BY order_row.id
  FOR UPDATE OF order_row;
  PERFORM request.id
  FROM public.customer_invoice_requests request
  JOIN jsonb_array_elements(p_items) item ON request.source_order_id = (item->>'order_id')::uuid
  WHERE item->>'status' = 'eligible'
  ORDER BY request.source_order_id
  FOR SHARE OF request;
  v_month := to_char(p_period_from AT TIME ZONE p_time_zone, 'YYYY-MM');
  v_status := CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_global_findings) finding
      WHERE finding->>'severity' = 'blocker')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) item WHERE item->>'status' = 'blocked')
    THEN 'blocked' ELSE 'ready' END;
  INSERT INTO public.fiscal_preflight_runs(status, period_from, period_to, time_zone, tax_rate, currency,
    configuration_report_id, settings_snapshot, global_findings, summary, requested_by, contract_version, local_month)
  VALUES (v_status, p_period_from, p_period_to, p_time_zone, p_tax_rate, upper(p_currency),
    p_configuration_report_id, p_settings_snapshot, p_global_findings, p_summary, p_requested_by, 2, v_month)
  RETURNING id INTO v_run_id;
  INSERT INTO public.fiscal_preflight_items(run_id, order_id, status, operation_at, operation_local_date,
    order_code, payment_reference, description, units, gross_cents, tax_base_cents, vat_cents, recipe_id,
    odoo_product_id, refund_required, refund_reference, findings, source_snapshot, source_sha256,
    invoice_mode, invoice_request_id, customer_fiscal_details, customer_fiscal_details_sha256,
    supporting_sale_order_id, supporting_sale_order_source_sha256)
  SELECT v_run_id, item.order_id, item.status, item.operation_at, item.operation_local_date,
    item.order_code, item.payment_reference, item.description, item.units, item.gross_cents,
    item.tax_base_cents, item.vat_cents, item.recipe_id, item.odoo_product_id, item.refund_required,
    item.refund_reference, item.findings, item.source_snapshot, item.source_sha256, item.invoice_mode,
    item.invoice_request_id, item.customer_fiscal_details, item.customer_fiscal_details_sha256,
    item.supporting_sale_order_id, item.supporting_sale_order_source_sha256
  FROM jsonb_to_recordset(p_items) AS item(order_id UUID, status TEXT, operation_at TIMESTAMPTZ,
    operation_local_date DATE, order_code TEXT, payment_reference TEXT, description TEXT, units NUMERIC,
    gross_cents BIGINT, tax_base_cents BIGINT, vat_cents BIGINT, recipe_id UUID, odoo_product_id INTEGER,
    refund_required BOOLEAN, refund_reference TEXT, findings JSONB, source_snapshot JSONB,
    source_sha256 TEXT, invoice_mode TEXT, invoice_request_id UUID, customer_fiscal_details JSONB,
    customer_fiscal_details_sha256 TEXT, supporting_sale_order_id UUID,
    supporting_sale_order_source_sha256 TEXT);
  GET DIAGNOSTICS v_item_count = ROW_COUNT;
  IF v_item_count <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Fiscal preflight item count mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_preflight_items item
    WHERE item.run_id = v_run_id AND (
      item.source_sha256 <> encode(extensions.digest(
        convert_to(public.canonical_jsonb_text(item.source_snapshot), 'UTF8'), 'sha256'), 'hex')
      OR item.source_snapshot->>'id' IS DISTINCT FROM item.order_id::text
      OR item.source_snapshot->>'order_code' IS DISTINCT FROM item.order_code
      OR (item.status = 'eligible' AND (
        item.operation_local_date < (p_period_from AT TIME ZONE p_time_zone)::date
        OR item.operation_local_date >= (p_period_to AT TIME ZONE p_time_zone)::date))
    )
  ) THEN RAISE EXCEPTION 'Fiscal v2 source snapshot identity or hash is invalid'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_preflight_items item
    WHERE item.run_id = v_run_id
      AND item.status <> 'excluded'
      AND (lower(COALESCE(item.source_snapshot->>'refund_status', '')) IN ('1', 'refunded')
        OR btrim(COALESCE(item.source_snapshot->>'pay_type_raw', '')) = '自动制作'
        OR lower(btrim(COALESCE(item.source_snapshot->>'pay_type_raw', ''))) = 'admin override')
  ) THEN RAISE EXCEPTION 'Fiscal v2 refunds and administrative non-sales must be excluded'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_preflight_items item
    LEFT JOIN public.manufacturing_sale_order_documents support ON support.id = item.supporting_sale_order_id
    LEFT JOIN public.huaxin_orders source_order ON source_order.id = item.order_id
    LEFT JOIN public.customer_invoice_requests request ON request.id = item.invoice_request_id
    WHERE item.run_id = v_run_id AND item.status = 'eligible' AND (
      support.id IS NULL OR source_order.id IS NULL OR support.source_order_id <> item.order_id
      OR support.source_sha256 IS DISTINCT FROM item.supporting_sale_order_source_sha256
      OR source_order.export_content_hash IS DISTINCT FROM support.source_sha256
      OR (item.invoice_mode = 'individual_requested' AND (
        request.id IS NULL OR request.source_order_id <> item.order_id
        OR request.fiscal_details IS DISTINCT FROM item.customer_fiscal_details
        OR request.fiscal_details_sha256 IS DISTINCT FROM item.customer_fiscal_details_sha256
        OR request.fiscal_details_sha256 <> encode(extensions.digest(
          convert_to(public.canonical_jsonb_text(request.fiscal_details), 'UTF8'), 'sha256'), 'hex')))
      OR (item.invoice_mode = 'monthly_consolidated' AND (
        item.invoice_request_id IS NOT NULL OR EXISTS (
          SELECT 1 FROM public.customer_invoice_requests current_request
          WHERE current_request.source_order_id = item.order_id
        )))
    )
  ) THEN RAISE EXCEPTION 'Fiscal v2 item snapshot does not match its accepted request or supporting sales order'; END IF;
  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_fiscal_invoice_job_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.preflight_run_id IS DISTINCT FROM OLD.preflight_run_id OR NEW.configuration_report_id IS DISTINCT FROM OLD.configuration_report_id
    OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
    OR NEW.local_date_from IS DISTINCT FROM OLD.local_date_from OR NEW.local_date_to IS DISTINCT FROM OLD.local_date_to
    OR NEW.execution_decisions IS DISTINCT FROM OLD.execution_decisions OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
    OR NEW.local_month IS DISTINCT FROM OLD.local_month THEN RAISE EXCEPTION 'Fiscal invoice job source fields are immutable'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_fiscal_invoice_batch_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.batch_sequence IS DISTINCT FROM OLD.batch_sequence
    OR NEW.preflight_run_id IS DISTINCT FROM OLD.preflight_run_id OR NEW.configuration_report_id IS DISTINCT FROM OLD.configuration_report_id
    OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
    OR NEW.local_date_from IS DISTINCT FROM OLD.local_date_from OR NEW.local_date_to IS DISTINCT FROM OLD.local_date_to
    OR NEW.draft_request_id IS DISTINCT FROM OLD.draft_request_id AND OLD.draft_request_id IS NOT NULL
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
    OR NEW.execution_decisions IS DISTINCT FROM OLD.execution_decisions OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
    OR NEW.confirmation_payload IS DISTINCT FROM OLD.confirmation_payload AND OLD.confirmation_payload IS NOT NULL
    OR NEW.confirmation_payload_sha256 IS DISTINCT FROM OLD.confirmation_payload_sha256 AND OLD.confirmation_payload_sha256 IS NOT NULL
    THEN RAISE EXCEPTION 'Fiscal invoice batch source fields are immutable'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_fiscal_invoice_source_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.preflight_item_id IS DISTINCT FROM OLD.preflight_item_id
    OR NEW.source_order_id IS DISTINCT FROM OLD.source_order_id OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
    OR NEW.invoice_payload IS DISTINCT FROM OLD.invoice_payload OR NEW.invoice_payload_sha256 IS DISTINCT FROM OLD.invoice_payload_sha256
    OR NEW.operation_at IS DISTINCT FROM OLD.operation_at OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
    OR NEW.order_code IS DISTINCT FROM OLD.order_code OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.gross_cents IS DISTINCT FROM OLD.gross_cents
    OR NEW.tax_base_cents IS DISTINCT FROM OLD.tax_base_cents OR NEW.vat_cents IS DISTINCT FROM OLD.vat_cents
    OR NEW.odoo_product_id IS DISTINCT FROM OLD.odoo_product_id OR NEW.odoo_tax_id IS DISTINCT FROM OLD.odoo_tax_id
    OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.contract_version IS DISTINCT FROM OLD.contract_version OR NEW.invoice_mode IS DISTINCT FROM OLD.invoice_mode
    OR NEW.local_month IS DISTINCT FROM OLD.local_month OR NEW.invoice_request_id IS DISTINCT FROM OLD.invoice_request_id
    OR NEW.customer_fiscal_details IS DISTINCT FROM OLD.customer_fiscal_details
    OR NEW.customer_fiscal_details_sha256 IS DISTINCT FROM OLD.customer_fiscal_details_sha256
    OR NEW.released_at IS DISTINCT FROM OLD.released_at AND OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fiscal invoice document source fields are immutable';
  END IF;
  NEW.updated_at := now(); RETURN NEW;
END;
$$;

ALTER TABLE public.odoo_sync_requests
  DROP CONSTRAINT odoo_sync_requests_fiscal_payload_check,
  ADD CONSTRAINT odoo_sync_requests_fiscal_payload_check CHECK ((
    (kind = 'stock_snapshot' AND payload = '{}'::jsonb AND payload_sha256 IS NULL)
    OR (kind = 'fiscal_product_remediation' AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1' AND jsonb_typeof(payload->'products') = 'array' AND payload_sha256 IS NOT NULL)
    OR (kind IN ('fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation')
      AND payload <> '{}'::jsonb AND payload->>'contract_version' IN ('1', '2')
      AND jsonb_typeof(payload->'company') = 'object' AND jsonb_typeof(payload->'invoices') = 'array'
      AND jsonb_array_length(payload->'invoices') BETWEEN 1 AND 500 AND payload_sha256 IS NOT NULL)
    OR (kind = 'fiscal_invoice_sale_link' AND payload <> '{}'::jsonb
      AND payload->>'contract_version' = '1' AND payload->>'local_month' ~ '^\d{4}-(0[1-9]|1[0-2])$'
      AND jsonb_typeof(payload->'links') = 'array'
      AND jsonb_array_length(payload->'links') BETWEEN 1 AND 500 AND payload_sha256 IS NULL)
  ) IS TRUE);

CREATE OR REPLACE FUNCTION public.create_fiscal_invoice_job_v2(
  p_preflight_run_id UUID, p_configuration_report_id UUID, p_requested_by UUID,
  p_payload JSONB, p_payload_sha256 TEXT, p_documents JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.fiscal_preflight_runs%ROWTYPE; v_report public.odoo_fiscal_configuration_reports%ROWTYPE;
  v_job_id UUID; v_batch_id UUID; v_request_id UUID; v_document JSONB; v_invoice JSONB;
  v_document_id UUID; v_eligible INTEGER; v_allocations INTEGER; v_inserted INTEGER;
  v_blocked INTEGER; v_excluded INTEGER; v_refunds INTEGER;
BEGIN
  SELECT * INTO v_run FROM public.fiscal_preflight_runs WHERE id = p_preflight_run_id FOR SHARE;
  IF NOT FOUND OR v_run.contract_version <> 2 OR v_run.time_zone <> 'Europe/Madrid' OR v_run.status <> 'ready'
    OR v_run.local_month IS NULL OR (v_run.period_from AT TIME ZONE v_run.time_zone)::date <> (v_run.local_month || '-01')::date
    OR (v_run.period_to AT TIME ZONE v_run.time_zone)::date <> ((v_run.local_month || '-01')::date + interval '1 month')::date
    OR v_run.period_to > now() THEN RAISE EXCEPTION 'Fiscal v2 requires one closed Europe/Madrid calendar month'; END IF;
  SELECT * INTO v_report FROM public.odoo_fiscal_configuration_reports WHERE id = p_configuration_report_id;
  IF NOT FOUND OR NOT v_report.accepted OR v_run.configuration_report_id IS DISTINCT FROM v_report.id THEN
    RAISE EXCEPTION 'The exact accepted configuration report is required';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object' OR jsonb_typeof(p_payload->'company') <> 'object'
    OR jsonb_typeof(p_payload->'journal') <> 'object' OR jsonb_typeof(p_payload->'tax') <> 'object'
    OR jsonb_typeof(p_payload->'invoices') <> 'array'
    OR p_payload->>'contract_version' <> '2' OR p_payload->>'local_month' IS DISTINCT FROM v_run.local_month
    OR p_payload->>'configuration_report_id' IS DISTINCT FROM v_report.id::text
    OR p_payload->>'configuration_payload_sha256' IS DISTINCT FROM v_report.payload_sha256
    OR p_payload_sha256 !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_documents) <> 'array'
    OR jsonb_array_length(p_documents) NOT BETWEEN 1 AND 500
    OR jsonb_array_length(p_payload->'invoices') <> jsonb_array_length(p_documents)
    OR jsonb_array_length(p_payload->'invoices') <> (
      SELECT count(DISTINCT invoice->>'platform_invoice_id') FROM jsonb_array_elements(p_payload->'invoices') invoice)
    OR p_payload_sha256 <> encode(extensions.digest(
      convert_to(public.canonical_jsonb_text(p_payload), 'UTF8'), 'sha256'), 'hex')
    OR octet_length(convert_to(public.canonical_jsonb_text(p_payload), 'UTF8')) > 8000000
    OR octet_length(convert_to(public.canonical_jsonb_text(p_documents), 'UTF8')) > 8000000
    OR octet_length(convert_to(public.canonical_jsonb_text(p_payload), 'UTF8'))
      + octet_length(convert_to(public.canonical_jsonb_text(p_documents), 'UTF8')) > 16000000 THEN
    RAISE EXCEPTION 'Invalid fiscal v2 payload';
  END IF;
  IF (p_payload->'company'->>'odoo_id')::integer IS DISTINCT FROM (v_report.payload->'company'->>'odoo_id')::integer
    OR v_report.payload_sha256 <> encode(extensions.digest(
      convert_to(public.canonical_jsonb_text(v_report.payload), 'UTF8'), 'sha256'), 'hex')
    OR upper(btrim(p_payload->'company'->>'country_code')) IS DISTINCT FROM upper(btrim(v_report.payload->'company'->>'country_code'))
    OR upper(btrim(p_payload->'company'->>'currency')) IS DISTINCT FROM upper(btrim(v_report.payload->'company'->>'currency'))
    OR upper(btrim(p_payload->'company'->>'currency')) IS DISTINCT FROM v_run.currency
    OR (p_payload->'tax'->>'odoo_tax_id')::integer IS DISTINCT FROM (v_report.payload->'tax'->>'odoo_id')::integer
    OR (p_payload->'tax'->>'rate')::numeric IS DISTINCT FROM (v_report.payload->'tax'->>'rate')::numeric
    OR upper(btrim(p_payload->'tax'->>'country_code')) IS DISTINCT FROM upper(btrim(v_report.payload->'tax'->>'country_code'))
    OR btrim(p_payload->'tax'->>'type_tax_use') IS DISTINCT FROM btrim(v_report.payload->'tax'->>'type_tax_use')
    OR btrim(p_payload->'tax'->>'amount_type') IS DISTINCT FROM btrim(v_report.payload->'tax'->>'amount_type')
    OR (p_payload->'tax'->>'price_include')::boolean IS DISTINCT FROM true
    OR (p_payload->'tax'->>'price_include')::boolean IS DISTINCT FROM (v_report.payload->'tax'->>'price_include')::boolean
    OR upper(p_payload->'journal'->>'code') IS DISTINCT FROM upper(v_report.payload->'journal'->>'code')
    OR (v_report.payload->'capabilities'->>'fiscal_invoice_allocation_v2')::integer IS DISTINCT FROM 1
    OR (v_report.payload->'capabilities'->>'manufacturing_transaction_sales')::integer IS DISTINCT FROM 1
    OR (EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'invoices') invoice,
        jsonb_array_elements(invoice->'lines') line WHERE line->'zero_value_reason' <> 'null'::jsonb)
      AND ((v_report.payload->'capabilities'->>'fiscal_zero_value_invoices')::integer IS NULL
        OR (v_report.payload->'capabilities'->>'fiscal_zero_value_invoices')::integer < 1))
    OR (EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'invoices') invoice,
        jsonb_array_elements(invoice->'lines') line WHERE line->>'zero_value_reason' = 'coupon')
      AND ((v_report.payload->'capabilities'->>'fiscal_zero_value_invoices')::integer IS NULL
        OR (v_report.payload->'capabilities'->>'fiscal_zero_value_invoices')::integer < 2)) THEN
    RAISE EXCEPTION 'Fiscal v2 configuration identity or capability mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.odoo_fiscal_settings WHERE singleton AND tax_treatment_approved
      AND upper(journal_code) = upper(p_payload->'journal'->>'code')
      AND customer_odoo_id = (v_report.payload->'customer'->>'odoo_id')::integer
      AND upper(currency) = upper(p_payload->'company'->>'currency')
      AND vat_rate = (p_payload->'tax'->>'rate')::numeric
  ) THEN RAISE EXCEPTION 'Current approved fiscal settings do not match the accepted report'; END IF;
  SELECT count(*) FILTER (WHERE status = 'eligible' AND NOT refund_required),
    count(*) FILTER (WHERE status = 'blocked'), count(*) FILTER (WHERE status = 'excluded'),
    count(*) FILTER (WHERE status = 'eligible' AND refund_required)
  INTO v_eligible, v_blocked, v_excluded, v_refunds FROM public.fiscal_preflight_items WHERE run_id = v_run.id;
  PERFORM order_row.id FROM public.huaxin_orders order_row
  JOIN public.fiscal_preflight_items item ON item.order_id = order_row.id
  WHERE item.run_id = v_run.id AND item.status = 'eligible' AND NOT item.refund_required
  ORDER BY order_row.id FOR UPDATE OF order_row;
  PERFORM request.id FROM public.customer_invoice_requests request
  JOIN public.fiscal_preflight_items item ON item.order_id = request.source_order_id
  WHERE item.run_id = v_run.id AND item.status = 'eligible' AND NOT item.refund_required
  ORDER BY request.source_order_id FOR SHARE OF request;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_preflight_items item
    LEFT JOIN public.customer_invoice_requests request ON request.source_order_id = item.order_id
    WHERE item.run_id = v_run.id AND item.status = 'eligible' AND NOT item.refund_required AND (
      (item.invoice_mode = 'individual_requested' AND (
        request.id IS NULL OR request.id IS DISTINCT FROM item.invoice_request_id
        OR request.fiscal_details IS DISTINCT FROM item.customer_fiscal_details
        OR request.fiscal_details_sha256 IS DISTINCT FROM item.customer_fiscal_details_sha256))
      OR (item.invoice_mode = 'monthly_consolidated' AND request.id IS NOT NULL)
    )
  ) THEN RAISE EXCEPTION 'Accepted customer invoice request state changed after preflight'; END IF;
  SELECT count(*) INTO v_allocations FROM jsonb_array_elements(p_documents) document,
    jsonb_array_elements(document->'invoice_payload'->'allocations') allocation;
  IF v_eligible = 0 OR v_blocked <> 0 OR v_allocations <> v_eligible OR v_allocations > 5000
    OR v_allocations <> (SELECT count(DISTINCT allocation->>'platform_allocation_id')
      FROM jsonb_array_elements(p_documents) document, jsonb_array_elements(document->'invoice_payload'->'allocations') allocation)
    OR v_allocations <> (SELECT count(DISTINCT allocation->>'preflight_item_id')
      FROM jsonb_array_elements(p_documents) document, jsonb_array_elements(document->'invoice_payload'->'allocations') allocation) THEN
    RAISE EXCEPTION 'Every invoiceable source must have exactly one allocation';
  END IF;
  IF (SELECT COALESCE(sum(jsonb_array_length(document->'invoice_payload'->'lines')), 0)
      FROM jsonb_array_elements(p_documents) document) > 5000 THEN
    RAISE EXCEPTION 'Fiscal v2 cannot exceed 5000 total source allocation lines';
  END IF;

  INSERT INTO public.fiscal_invoice_jobs(preflight_run_id, configuration_report_id, period_from, period_to,
    local_date_from, local_date_to, status, execution_decisions, requested_by, contract_version, local_month)
  VALUES (v_run.id, v_report.id, v_run.period_from, v_run.period_to,
    (v_run.local_month || '-01')::date, ((v_run.local_month || '-01')::date + interval '1 month - 1 day')::date,
    'draft_pending', jsonb_build_object('queued_invoiceable', v_eligible, 'skipped_blocked', v_blocked,
      'skipped_excluded', v_excluded, 'skipped_refund_review', v_refunds,
      'configuration_report_checked_at', v_report.checked_at,
      'configuration_report_stale_at_execution', v_report.checked_at < now() - interval '24 hours'),
    p_requested_by, 2, v_run.local_month) RETURNING id INTO v_job_id;
  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_draft_creation', p_requested_by, p_payload, p_payload_sha256) RETURNING id INTO v_request_id;
  INSERT INTO public.fiscal_invoice_batches(job_id, batch_sequence, preflight_run_id, configuration_report_id,
    period_from, period_to, local_date_from, local_date_to, status, draft_request_id, latest_draft_request_id,
    payload, payload_sha256, execution_decisions, requested_by, contract_version)
  VALUES (v_job_id, 1, v_run.id, v_report.id, v_run.period_from, v_run.period_to,
    (v_run.local_month || '-01')::date, ((v_run.local_month || '-01')::date + interval '1 month - 1 day')::date,
    'draft_pending', v_request_id, v_request_id, p_payload, p_payload_sha256, '{}'::jsonb, p_requested_by, 2)
  RETURNING id INTO v_batch_id;

  FOR v_document IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
    v_invoice := v_document->'invoice_payload';
    v_document_id := (v_document->>'platform_invoice_id')::uuid;
    IF v_invoice->>'platform_invoice_id' IS DISTINCT FROM v_document_id::text
      OR v_invoice->>'invoice_payload_sha256' IS DISTINCT FROM v_document->>'invoice_payload_sha256'
      OR v_invoice->>'invoice_payload_sha256' <> encode(extensions.digest(
        convert_to(public.canonical_jsonb_text(v_invoice - 'invoice_payload_sha256'), 'UTF8'), 'sha256'), 'hex')
      OR NOT p_payload->'invoices' @> jsonb_build_array(v_invoice)
      OR v_invoice->>'move_type' IS DISTINCT FROM 'out_invoice'
      OR v_invoice->>'invoice_mode' NOT IN ('individual_requested', 'monthly_consolidated')
      OR v_invoice->>'local_month' IS DISTINCT FROM v_run.local_month
      OR v_invoice->>'currency' IS DISTINCT FROM v_run.currency
      OR jsonb_array_length(v_invoice->'allocations') <> jsonb_array_length(v_invoice->'lines')
      OR jsonb_array_length(v_invoice->'allocations') = 0
      OR (v_invoice->>'invoice_mode' = 'individual_requested' AND jsonb_array_length(v_invoice->'allocations') <> 1)
      OR (v_invoice->>'invoice_mode' = 'monthly_consolidated' AND
        (v_invoice->'customer' IS DISTINCT FROM jsonb_build_object('odoo_id',
          (SELECT customer_odoo_id FROM public.odoo_fiscal_settings WHERE singleton))
        OR v_invoice->>'invoice_date' IS DISTINCT FROM
          (((v_run.local_month || '-01')::date + interval '1 month - 1 day')::date)::text
        OR v_invoice->>'reference' IS DISTINCT FROM 'SoftLife ' || v_run.local_month
        OR v_invoice->'zero_value_reason' IS DISTINCT FROM 'null'::jsonb))
      THEN RAISE EXCEPTION 'Invalid fiscal v2 document'; END IF;
    INSERT INTO public.fiscal_invoice_documents(id, batch_id, invoice_payload, invoice_payload_sha256,
      invoice_date, currency, gross_cents, tax_base_cents, vat_cents, odoo_tax_id, reference, status,
      contract_version, invoice_mode, local_month, invoice_request_id, customer_fiscal_details,
      customer_fiscal_details_sha256)
    VALUES (v_document_id, v_batch_id, v_invoice, v_document->>'invoice_payload_sha256',
      (v_invoice->>'invoice_date')::date, v_run.currency, (v_invoice->>'expected_total_cents')::bigint,
      (SELECT sum((line->>'tax_base_cents')::bigint) FROM jsonb_array_elements(v_invoice->'lines') line),
      (SELECT sum((line->>'vat_cents')::bigint) FROM jsonb_array_elements(v_invoice->'lines') line),
      (p_payload->'tax'->>'odoo_tax_id')::integer, v_invoice->>'reference', 'draft_pending', 2,
      v_invoice->>'invoice_mode', v_run.local_month,
      CASE WHEN v_invoice->>'invoice_mode' = 'individual_requested' THEN (v_invoice->'customer'->>'request_id')::uuid ELSE NULL END,
      CASE WHEN v_invoice->>'invoice_mode' = 'individual_requested' THEN v_invoice->'customer' - 'request_id' - 'fiscal_details_sha256' ELSE NULL END,
      CASE WHEN v_invoice->>'invoice_mode' = 'individual_requested' THEN v_invoice->'customer'->>'fiscal_details_sha256' ELSE NULL END);

    INSERT INTO public.fiscal_invoice_source_allocations(id, document_id, preflight_item_id, source_order_id,
      source_sha256, invoice_request_id, supporting_sale_order_id, supporting_sale_order_source_sha256, odoo_sale_order_id,
      odoo_sale_order_line_id, line_sequence)
    SELECT (allocation->>'platform_allocation_id')::uuid, v_document_id, item.id, item.order_id,
      item.source_sha256, item.invoice_request_id, support.id, support.source_sha256, support.odoo_sale_order_id,
      support.odoo_sale_order_line_id, (allocation->>'line_sequence')::integer
    FROM jsonb_array_elements(v_invoice->'allocations') allocation
    JOIN public.fiscal_preflight_items item ON item.id = (allocation->>'preflight_item_id')::uuid
    JOIN public.manufacturing_sale_order_documents support ON support.id = item.supporting_sale_order_id
    JOIN LATERAL (SELECT value AS line, ordinality FROM jsonb_array_elements(v_invoice->'lines') WITH ORDINALITY
      WHERE value->>'platform_allocation_id' = allocation->>'platform_allocation_id') matched ON true
    WHERE item.run_id = v_run.id AND item.status = 'eligible' AND NOT item.refund_required
      AND item.order_id = (allocation->>'source_order_id')::uuid
      AND item.source_sha256 = allocation->>'source_sha256'
      AND item.invoice_mode = v_invoice->>'invoice_mode'
      AND (allocation->>'line_sequence')::integer = matched.ordinality
      AND item.invoice_request_id IS NOT DISTINCT FROM
        CASE WHEN allocation->>'invoice_request_id' IS NULL THEN NULL ELSE (allocation->>'invoice_request_id')::uuid END
      AND support.source_order_id = item.order_id
      AND support.id = (allocation->>'supporting_sale_order_id')::uuid
      AND support.source_sha256 = item.supporting_sale_order_source_sha256
      AND support.source_sha256 = allocation->>'supporting_sale_order_source_sha256'
      AND support.source_sha256 = (SELECT source_order.export_content_hash FROM public.huaxin_orders source_order
        WHERE source_order.id = item.order_id)
      AND support.odoo_sale_order_id = (allocation->>'odoo_sale_order_id')::integer
      AND support.odoo_sale_order_line_id = (allocation->>'odoo_sale_order_line_id')::integer
      AND (v_invoice->>'invoice_mode' = 'monthly_consolidated' OR (
        v_invoice->>'invoice_date' = item.operation_local_date::text
        AND v_invoice->>'reference' = COALESCE(NULLIF(btrim(item.payment_reference), ''), item.order_code)
        AND v_invoice->'zero_value_reason' IS NOT DISTINCT FROM matched.line->'zero_value_reason'))
      AND (matched.line->>'odoo_product_id')::integer = item.odoo_product_id
      AND matched.line->>'description' = item.description
      AND (matched.line->>'quantity')::numeric = item.units
      AND (matched.line->>'gross_cents')::bigint = item.gross_cents
      AND (matched.line->>'tax_base_cents')::bigint = item.tax_base_cents
      AND (matched.line->>'vat_cents')::bigint = item.vat_cents
      AND matched.line->>'zero_value_reason' IS NOT DISTINCT FROM CASE btrim(item.source_snapshot->>'pay_type_raw')
        WHEN '免费' THEN 'free' WHEN 'Free' THEN 'free'
        WHEN '自动制作' THEN 'admin_override' WHEN 'Admin override' THEN 'admin_override'
        WHEN '串码支付' THEN 'coupon' WHEN 'Coupon' THEN 'coupon' ELSE NULL END
      AND (matched.line->>'odoo_tax_id')::integer = (p_payload->'tax'->>'odoo_tax_id')::integer
      AND (matched.line->>'odoo_sale_order_id')::integer = support.odoo_sale_order_id
      AND (matched.line->>'odoo_sale_order_line_id')::integer = support.odoo_sale_order_line_id;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted <> jsonb_array_length(v_invoice->'allocations') THEN
      RAISE EXCEPTION 'Fiscal v2 allocation/source mismatch';
    END IF;
    IF (v_invoice->>'expected_total_cents')::bigint IS DISTINCT FROM (
      SELECT sum(item.gross_cents) FROM public.fiscal_invoice_source_allocations allocation
      JOIN public.fiscal_preflight_items item ON item.id = allocation.preflight_item_id
      WHERE allocation.document_id = v_document_id
    ) THEN RAISE EXCEPTION 'Fiscal v2 document total mismatch'; END IF;
    IF v_invoice->>'invoice_mode' = 'individual_requested' AND NOT EXISTS (
      SELECT 1 FROM public.fiscal_invoice_source_allocations allocation
      JOIN public.fiscal_preflight_items item ON item.id = allocation.preflight_item_id
      JOIN public.customer_invoice_requests request ON request.id = allocation.invoice_request_id
      JOIN public.fiscal_invoice_documents document ON document.id = allocation.document_id
      WHERE allocation.document_id = v_document_id AND document.invoice_request_id = request.id
        AND document.customer_fiscal_details = request.fiscal_details
        AND document.customer_fiscal_details_sha256 = request.fiscal_details_sha256
        AND item.customer_fiscal_details = request.fiscal_details
        AND item.customer_fiscal_details_sha256 = request.fiscal_details_sha256
    ) THEN RAISE EXCEPTION 'Requested invoice customer snapshot mismatch'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.fiscal_invoice_source_allocations allocation
      JOIN public.fiscal_invoice_documents document ON document.id = allocation.document_id
      WHERE document.batch_id = v_batch_id) <> v_eligible THEN
    RAISE EXCEPTION 'Fiscal v2 job allocation coverage changed';
  END IF;
  RETURN jsonb_build_object('job_id', v_job_id, 'request_id', v_request_id,
    'document_count', jsonb_array_length(p_documents), 'allocation_count', v_eligible, 'batch_count', 1,
    'skipped_blocked', v_blocked, 'skipped_excluded', v_excluded, 'skipped_refund_review', v_refunds);
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_fiscal_invoice_job_confirmation(
  p_job_id UUID, p_requested_by UUID, p_batches JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.fiscal_invoice_jobs%ROWTYPE; v_batch public.fiscal_invoice_batches%ROWTYPE;
  v_batch_input JSONB; v_payload JSONB; v_expected INTEGER; v_total INTEGER := 0;
  v_batch_count INTEGER; v_request_id UUID;
BEGIN
  SELECT * INTO v_job FROM public.fiscal_invoice_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status NOT IN ('draft_ready', 'confirmation_failed') THEN
    RAISE EXCEPTION 'Fiscal invoice job is not ready for confirmation';
  END IF;
  IF jsonb_typeof(p_batches) <> 'array' OR jsonb_array_length(p_batches) < 1 THEN
    RAISE EXCEPTION 'Confirmation payloads are required';
  END IF;
  v_batch_count := jsonb_array_length(p_batches);
  IF v_batch_count <> (SELECT count(*) FROM public.fiscal_invoice_batches WHERE job_id = p_job_id AND status <> 'completed')
    OR (SELECT count(DISTINCT batch->>'batch_id') FROM jsonb_array_elements(p_batches) batch) <> v_batch_count
    OR EXISTS (
      SELECT id FROM public.fiscal_invoice_batches WHERE job_id = p_job_id AND status <> 'completed'
      EXCEPT SELECT (batch->>'batch_id')::uuid FROM jsonb_array_elements(p_batches) batch
    ) OR EXISTS (
      SELECT (batch->>'batch_id')::uuid FROM jsonb_array_elements(p_batches) batch
      EXCEPT SELECT id FROM public.fiscal_invoice_batches WHERE job_id = p_job_id AND status <> 'completed'
    ) THEN RAISE EXCEPTION 'Confirmation payloads must cover each unfinished internal batch exactly once'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.odoo_fiscal_settings WHERE singleton AND tax_treatment_approved) THEN
    RAISE EXCEPTION 'Current vending tax treatment approval is required';
  END IF;
  FOR v_batch_input IN SELECT value FROM jsonb_array_elements(p_batches) LOOP
    SELECT * INTO v_batch FROM public.fiscal_invoice_batches
      WHERE id = (v_batch_input->>'batch_id')::uuid AND job_id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_batch.status NOT IN ('draft_ready', 'confirmation_failed') THEN
      RAISE EXCEPTION 'An internal batch is not ready for confirmation';
    END IF;
    v_payload := v_batch_input->'payload';
    IF jsonb_typeof(v_payload) <> 'object'
      OR (v_payload->>'contract_version')::integer IS DISTINCT FROM v_batch.contract_version
      OR v_payload->>'contract_version' NOT IN ('1', '2')
      OR jsonb_typeof(v_payload->'invoices') <> 'array'
      OR jsonb_array_length(v_payload->'invoices') NOT BETWEEN 1 AND 500
      OR v_batch_input->>'payload_sha256' !~ '^[0-9a-f]{64}$'
      OR v_batch_input->>'payload_sha256' <> encode(extensions.digest(
        convert_to(public.canonical_jsonb_text(v_payload), 'UTF8'), 'sha256'), 'hex')
      OR octet_length(convert_to(public.canonical_jsonb_text(v_payload), 'UTF8')) > 500000
      OR v_payload->'company'->>'odoo_id' IS DISTINCT FROM v_batch.payload->'company'->>'odoo_id' THEN
      RAISE EXCEPTION 'An internal confirmation payload is invalid';
    END IF;
    v_expected := jsonb_array_length(v_payload->'invoices');
    IF v_expected <> (SELECT count(*) FROM public.fiscal_invoice_documents WHERE batch_id = v_batch.id AND status = 'draft')
      OR (SELECT count(DISTINCT invoice->>'platform_invoice_id') FROM jsonb_array_elements(v_payload->'invoices') invoice) <> v_expected
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_payload->'invoices') invoice
        LEFT JOIN public.fiscal_invoice_documents document
          ON document.id = (invoice->>'platform_invoice_id')::uuid AND document.batch_id = v_batch.id
          AND document.status = 'draft' AND document.odoo_move_id = (invoice->>'odoo_move_id')::integer
          AND document.invoice_payload_sha256 = invoice->>'invoice_payload_sha256'
        WHERE document.id IS NULL
      ) THEN RAISE EXCEPTION 'Confirmation payload does not match every draft document in its internal batch'; END IF;
    IF v_batch.confirmation_payload IS NOT NULL AND (
      v_batch.confirmation_payload IS DISTINCT FROM v_payload
      OR v_batch.confirmation_payload_sha256 IS DISTINCT FROM v_batch_input->>'payload_sha256'
    ) THEN RAISE EXCEPTION 'A different confirmation payload is already frozen for this internal batch'; END IF;
    UPDATE public.fiscal_invoice_batches SET confirmation_payload = v_payload,
      confirmation_payload_sha256 = v_batch_input->>'payload_sha256' WHERE id = v_batch.id;
    v_total := v_total + v_expected;
  END LOOP;
  SELECT * INTO v_batch FROM public.fiscal_invoice_batches
    WHERE job_id = p_job_id AND status <> 'completed' ORDER BY batch_sequence LIMIT 1 FOR UPDATE;
  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_bulk_confirmation', p_requested_by, v_batch.confirmation_payload, v_batch.confirmation_payload_sha256)
  RETURNING id INTO v_request_id;
  UPDATE public.fiscal_invoice_documents SET status = 'confirmation_pending'
    WHERE batch_id = v_batch.id AND status = 'draft';
  UPDATE public.fiscal_invoice_batches SET status = 'confirmation_pending', latest_confirmation_request_id = v_request_id,
    failed_at = NULL, error = NULL WHERE id = v_batch.id;
  UPDATE public.fiscal_invoice_jobs SET status = 'confirmation_pending', failed_at = NULL, error = NULL WHERE id = p_job_id;
  RETURN jsonb_build_object('job_id', p_job_id, 'request_id', v_request_id,
    'document_count', v_total, 'batch_count', v_batch_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_empty_failed_fiscal_invoice_job(p_job_id UUID, p_cancelled_by UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.fiscal_invoice_jobs%ROWTYPE; v_document_count INTEGER;
BEGIN
  SELECT * INTO v_job FROM public.fiscal_invoice_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'failed' THEN RAISE EXCEPTION 'Only a failed fiscal invoice job can be cancelled'; END IF;
  IF p_cancelled_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_cancelled_by) THEN
    RAISE EXCEPTION 'A valid cancellation actor is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_invoice_documents document
    JOIN public.fiscal_invoice_batches batch ON batch.id = document.batch_id
    WHERE batch.job_id = p_job_id AND (document.odoo_move_id IS NOT NULL OR document.odoo_state IS NOT NULL
      OR document.odoo_name IS NOT NULL OR document.draft_created_at IS NOT NULL OR document.posted_at IS NOT NULL
      OR document.status NOT IN ('draft_failed', 'queued'))
  ) THEN RAISE EXCEPTION 'A fiscal invoice job with created or active Odoo invoices cannot be cancelled'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.odoo_sync_requests request
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(request.result->'invoices') = 'array'
      THEN request.result->'invoices' ELSE '[]'::jsonb END) invoice
    JOIN public.fiscal_invoice_documents document ON invoice->>'platform_invoice_id' = document.id::text
    JOIN public.fiscal_invoice_batches batch ON batch.id = document.batch_id
    WHERE batch.job_id = p_job_id AND invoice ? 'odoo_move_id' AND invoice->'odoo_move_id' <> 'null'::jsonb
  ) THEN RAISE EXCEPTION 'A fiscal invoice job whose connector result contains an Odoo identity cannot be cancelled'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.odoo_sync_requests request JOIN public.fiscal_invoice_batches batch
      ON request.id IN (batch.latest_draft_request_id, batch.latest_confirmation_request_id)
    WHERE batch.job_id = p_job_id AND request.status IN ('pending', 'processing')
  ) THEN RAISE EXCEPTION 'A fiscal invoice job with an active Odoo request cannot be cancelled'; END IF;
  SELECT count(*) INTO v_document_count FROM public.fiscal_invoice_documents document
    JOIN public.fiscal_invoice_batches batch ON batch.id = document.batch_id WHERE batch.job_id = p_job_id;
  UPDATE public.fiscal_invoice_source_allocations allocation SET status = 'released', released_at = now()
  FROM public.fiscal_invoice_documents document JOIN public.fiscal_invoice_batches batch ON batch.id = document.batch_id
  WHERE allocation.document_id = document.id AND batch.job_id = p_job_id;
  UPDATE public.fiscal_invoice_documents document SET cancelled_at = now(), released_at = now()
  FROM public.fiscal_invoice_batches batch WHERE batch.id = document.batch_id AND batch.job_id = p_job_id;
  UPDATE public.fiscal_invoice_batches SET status = 'cancelled' WHERE job_id = p_job_id AND status IN ('failed', 'queued');
  UPDATE public.fiscal_invoice_jobs SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_cancelled_by WHERE id = p_job_id;
  RETURN jsonb_build_object('job_id', p_job_id, 'document_count', v_document_count);
END;
$$;

ALTER TABLE public.customer_invoice_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_sale_order_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_invoice_source_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_invoice_requests, public.manufacturing_sale_order_documents,
  public.fiscal_invoice_source_allocations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.customer_invoice_requests, public.manufacturing_sale_order_documents,
  public.fiscal_invoice_source_allocations FROM service_role;
GRANT SELECT ON public.customer_invoice_requests, public.manufacturing_sale_order_documents,
  public.fiscal_invoice_source_allocations TO service_role;
ALTER TABLE public.manufacturing_period_exports ADD CONSTRAINT manufacturing_v3_result_size_check CHECK (
  odoo_result IS NULL OR payload->>'manufacturing_contract_version' IS DISTINCT FROM '3'
    OR octet_length(convert_to(public.canonical_jsonb_text(odoo_result), 'UTF8')) <= 5000000
) NOT VALID;
ALTER TABLE public.odoo_sync_requests ADD CONSTRAINT fiscal_invoice_result_size_check CHECK (
  result IS NULL OR kind NOT IN ('fiscal_invoice_draft_creation', 'fiscal_invoice_bulk_confirmation')
    OR octet_length(convert_to(public.canonical_jsonb_text(result), 'UTF8')) <= 500000
) NOT VALID;
REVOKE ALL ON FUNCTION public.canonical_jsonb_text(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_jsonb_text(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.record_customer_invoice_request(TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_manufacturing_export_result_v3(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_fiscal_preflight_v2(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, JSONB, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_fiscal_invoice_job_v2(UUID, UUID, UUID, JSONB, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_fiscal_invoice_job_confirmation(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_empty_failed_fiscal_invoice_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_invoice_request(TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_manufacturing_export_result_v3(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_fiscal_preflight_v2(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, JSONB, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_fiscal_invoice_job_v2(UUID, UUID, UUID, JSONB, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_fiscal_invoice_job_confirmation(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_empty_failed_fiscal_invoice_job(UUID, UUID) TO service_role;
