DROP VIEW public.v_orders;

ALTER TABLE public.huaxin_orders
  ALTER COLUMN price TYPE NUMERIC USING price::NUMERIC,
  ALTER COLUMN amount TYPE NUMERIC USING amount::NUMERIC,
  ADD COLUMN status_code TEXT,
  ADD COLUMN market_price NUMERIC,
  ADD COLUMN discount_price NUMERIC,
  ADD COLUMN re_price NUMERIC,
  ADD COLUMN products JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN nums NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN pay_type_raw TEXT,
  ADD COLUMN pay_time TIMESTAMPTZ,
  ADD COLUMN create_time_utc TIMESTAMPTZ,
  ADD COLUMN refund_status TEXT,
  ADD COLUMN refund_out_no TEXT,
  ADD COLUMN coupon_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN activity_name TEXT,
  ADD COLUMN device_label TEXT,
  ADD COLUMN list_raw JSONB,
  ADD COLUMN webhook_raw JSONB,
  ADD COLUMN ingest_source TEXT NOT NULL DEFAULT 'pull' CHECK (ingest_source IN ('pull', 'webhook')),
  ADD COLUMN first_ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN last_ingested_at TIMESTAMPTZ NOT NULL DEFAULT now();

WITH payloads AS (
  SELECT id, raw::JSONB AS payload
  FROM public.huaxin_orders
  WHERE raw IS NOT NULL
)
UPDATE public.huaxin_orders o
SET list_raw = p.payload,
    status_code = COALESCE(p.payload->>'status', o.order_state),
    market_price = NULLIF(p.payload->>'marketPrice', '')::NUMERIC,
    discount_price = NULLIF(p.payload->>'discountPrice', '')::NUMERIC,
    re_price = NULLIF(p.payload->>'rePrice', '')::NUMERIC,
    products = CASE WHEN jsonb_typeof(p.payload->'products') = 'array' THEN p.payload->'products' ELSE '[]'::jsonb END,
    nums = COALESCE(NULLIF(p.payload->>'nums', '')::NUMERIC, o.amount, 1),
    pay_type_raw = p.payload->>'payType',
    pay_time = CASE WHEN NULLIF(p.payload->>'localPayTime', '') IS NOT NULL
      THEN replace(p.payload->>'localPayTime', ' ', 'T')::TIMESTAMP AT TIME ZONE 'Asia/Shanghai'
      ELSE NULL END,
    create_time_utc = NULLIF(p.payload->>'createTimeUtc', '')::TIMESTAMPTZ,
    refund_status = p.payload->>'refundStatus',
    refund_out_no = p.payload->>'refundOutNo',
    coupon_used = COALESCE((p.payload #>> '{coupon,result}')::BOOLEAN, false),
    activity_name = p.payload->>'activityName',
    device_label = p.payload->>'deviceLabel',
    ingest_source = 'pull',
    last_ingested_at = now()
FROM payloads p
WHERE p.id = o.id;

UPDATE public.huaxin_orders o
SET tenant_id = COALESCE((
  SELECT a.tenant_id
  FROM public.machine_franchisee_assignments a
  WHERE a.machine_id = o.machine_id
    AND a.start_date <= (o.order_time AT TIME ZONE 'Europe/Madrid')::DATE
    AND (a.end_date IS NULL OR a.end_date >= (o.order_time AT TIME ZONE 'Europe/Madrid')::DATE)
  ORDER BY a.start_date DESC
  LIMIT 1
), (SELECT m.tenant_id FROM public.machines m WHERE m.id = o.machine_id))
WHERE o.tenant_id IS NULL;

ALTER TABLE public.huaxin_orders ALTER COLUMN order_code SET NOT NULL;

CREATE INDEX huaxin_orders_machine_time_idx ON public.huaxin_orders (machine_id, order_time DESC);
CREATE INDEX huaxin_orders_imei_time_idx ON public.huaxin_orders (device_imei, order_time DESC);
CREATE INDEX huaxin_orders_tenant_time_idx ON public.huaxin_orders (tenant_id, order_time DESC);
CREATE INDEX huaxin_orders_out_trade_no_idx ON public.huaxin_orders (out_trade_no) WHERE out_trade_no IS NOT NULL;

CREATE VIEW public.v_orders
WITH (security_invoker = true)
AS
SELECT o.id, o.order_time, o.order_code, o.out_trade_no, o.order_state, o.status_code,
       o.price, o.market_price, o.discount_price, o.re_price, o.amount,
       o.product_name, o.products, o.nums, o.pay_type_raw, o.pay_time,
       o.create_time_utc, o.refund_status, o.refund_out_no, o.coupon_used,
       o.activity_name, o.device_label, o.device_imei, o.machine_id, o.tenant_id,
       o.ingest_source, o.first_ingested_at, o.last_ingested_at, m.name AS machine_name
FROM public.huaxin_orders o
LEFT JOIN public.machines m ON m.id = o.machine_id;

GRANT SELECT ON public.v_orders TO authenticated;
