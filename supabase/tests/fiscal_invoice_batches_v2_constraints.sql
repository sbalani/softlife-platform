BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.fiscal_invoice_batches'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%payload%contract_version% = ''1''::text%'
  ) THEN
    RAISE EXCEPTION 'A fiscal_invoice_batches check constraint still forces payload contract_version 1';
  END IF;
END;
$$;

CREATE TEMP TABLE fiscal_invoice_batches_v2_probe
  (LIKE public.fiscal_invoice_batches INCLUDING ALL);

INSERT INTO fiscal_invoice_batches_v2_probe(
  id, preflight_run_id, configuration_report_id, period_from, period_to,
  local_date_from, local_date_to, status, draft_request_id, latest_draft_request_id,
  payload, payload_sha256, job_id, batch_sequence, contract_version
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '2026-08-31 22:00:00+00', '2026-09-30 22:00:00+00',
  '2026-09-01', '2026-09-30', 'draft_pending',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000004',
  jsonb_build_object(
    'contract_version', 2,
    'local_month', '2026-09',
    'company', jsonb_build_object('odoo_id', 1),
    'journal', jsonb_build_object('code', 'VEND'),
    'tax', jsonb_build_object('odoo_tax_id', 1, 'price_include', true),
    'invoices', jsonb_build_array(jsonb_build_object(
      'platform_invoice_id', '10000000-0000-4000-8000-000000000005',
      'invoice_mode', 'monthly_consolidated',
      'allocations', jsonb_build_array(jsonb_build_object(
        'platform_allocation_id', '10000000-0000-4000-8000-000000000006'))
    ))
  ),
  repeat('a', 64),
  '10000000-0000-4000-8000-000000000007', 1, 2
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_invoice_batches_v2_probe
    WHERE contract_version = 2 AND payload->>'contract_version' = '2'
  ) THEN
    RAISE EXCEPTION 'Representative fiscal v2 batch did not pass migrated constraints';
  END IF;
END;
$$;

ROLLBACK;
