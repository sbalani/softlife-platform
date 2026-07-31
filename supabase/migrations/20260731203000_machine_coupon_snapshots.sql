CREATE TABLE public.machine_coupon_snapshots (
  machine_id UUID PRIMARY KEY REFERENCES public.machines(id) ON DELETE CASCADE,
  device_imei TEXT NOT NULL UNIQUE,
  coupons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(coupons) = 'array'),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_coupon_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_coupon_snapshots FROM anon, authenticated;

-- Existing coupon audit rows contain Huaxin session IDs and generated voucher
-- codes. Retain only non-secret operation outcomes.
UPDATE public.machine_change_log
SET new_value = jsonb_strip_nulls(jsonb_build_object(
  'code', new_value->'code',
  'result', new_value->'result',
  'msg', new_value->'msg',
  'error', new_value->'error',
  'data', jsonb_strip_nulls(jsonb_build_object(
    'result', new_value#>'{data,result}',
    'message', new_value#>'{data,message}',
    'couponId', new_value#>'{data,couponId}',
    'recordCount', CASE
      WHEN jsonb_typeof(new_value#>'{data,records}') = 'array' THEN jsonb_array_length(new_value#>'{data,records}')
      WHEN jsonb_typeof(new_value#>'{data,list}') = 'array' THEN jsonb_array_length(new_value#>'{data,list}')
      ELSE NULL
    END
  ))
))
WHERE entity_type = 'coupon';
