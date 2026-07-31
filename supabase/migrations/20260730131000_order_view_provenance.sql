CREATE INDEX IF NOT EXISTS huaxin_orders_tenant_time_idx
  ON public.huaxin_orders (tenant_id, order_time DESC);

DROP VIEW public.v_orders;
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
