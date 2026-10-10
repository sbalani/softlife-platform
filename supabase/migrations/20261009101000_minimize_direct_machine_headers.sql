UPDATE public.direct_machine_payloads
SET request_headers = COALESCE((
  SELECT jsonb_object_agg(header.key, header.value)
  FROM jsonb_each(request_headers) AS header
  WHERE header.key = ANY (ARRAY[
    'content-encoding',
    'content-type',
    'user-agent',
    'x-device-id',
    'x-device-imei',
    'x-machine-id'
  ])
), '{}'::JSONB);

COMMENT ON COLUMN public.direct_machine_payloads.request_headers IS
  'Allowlisted request metadata only; credentials, cookies, and network addresses are never retained.';
