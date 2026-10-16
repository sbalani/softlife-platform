export type HuaxinDevice = {
  deviceImei?: string;
  deviceName?: string;
  deviceLabel?: unknown;
};
export type HuaxinOrder = {
  orderCode?: string;
  outTradeNo?: string;
  price?: string | number;
  amount?: string | number;
  marketPrice?: string | number;
  discountPrice?: string | number;
  rePrice?: string | number;
  nums?: string | number;
  status?: string | number;
  payType?: string;
  payTime?: string;
  localPayTime?: string;
  createTime?: string;
  createTimeUtc?: string;
  productName?: string;
  goodsName?: string;
  refundStatus?: string | number;
  refundOutNo?: string | null;
  coupon?: { result?: boolean; [key: string]: unknown };
  activityName?: string;
  deviceLabel?: string;
  products?: { goodsName?: string; price?: string; position?: number }[];
  [key: string]: unknown;
};
export type OrderAssignment = {
  machine_id: string;
  tenant_id: string;
  start_date: string;
  end_date: string | null;
};
export type MachineRef = {
  id: string | null;
  tenantId: string | null;
  imei: string;
};

function iso(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function huaxinLocalTimeToUtc(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().replace(" ", "T");
  return iso(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
      ? normalized
      : `${normalized}+08:00`,
  );
}

export function huaxinOrderTime(
  order: Pick<
    HuaxinOrder,
    "createTimeUtc" | "createTime" | "localPayTime" | "payTime"
  >,
) {
  return huaxinLocalTimeToUtc(order.localPayTime) ??
    (order.createTimeUtc ? iso(order.createTimeUtc) : null) ??
    huaxinLocalTimeToUtc(order.createTime) ??
    huaxinLocalTimeToUtc(order.payTime);
}

export function madridDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function previousCalendarDate(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function tenantForOrder(
  assignments: OrderAssignment[],
  machineId: string | null,
  orderTime: string | null,
) {
  if (!machineId || !orderTime) return null;
  const day = madridDate(new Date(orderTime));
  return assignments
    .filter((assignment) =>
      assignment.machine_id === machineId && assignment.start_date <= day &&
      (!assignment.end_date || assignment.end_date >= day)
    )
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]?.tenant_id ??
    null;
}

export function orderRowFromHuaxin(
  order: HuaxinOrder,
  machine: MachineRef,
  ingestedAt = new Date().toISOString(),
) {
  const products = Array.isArray(order.products) ? order.products : [];
  return {
    tenant_id: machine.tenantId,
    machine_id: machine.id,
    device_imei: machine.imei,
    order_code: order.orderCode!,
    out_trade_no: order.outTradeNo ?? null,
    order_state: String(order.status ?? ""),
    status_code: String(order.status ?? ""),
    order_time: huaxinOrderTime(order),
    price: Number(order.price ?? 0),
    market_price: order.marketPrice == null ? null : Number(order.marketPrice),
    discount_price: order.discountPrice == null
      ? null
      : Number(order.discountPrice),
    re_price: order.rePrice == null ? null : Number(order.rePrice),
    amount: Number(order.amount ?? 1),
    product_name: products[0]?.goodsName ?? order.productName ??
      order.goodsName ?? null,
    products,
    nums: Number(order.nums ?? 1),
    pay_type_raw: order.payType ?? null,
    pay_time: huaxinLocalTimeToUtc(order.localPayTime ?? order.payTime),
    create_time_utc: order.createTimeUtc ?? null,
    refund_status: order.refundStatus == null
      ? null
      : String(order.refundStatus),
    refund_out_no: order.refundOutNo ?? null,
    coupon_used: order.coupon?.result === true,
    activity_name: order.activityName ?? null,
    device_label: order.deviceLabel ?? null,
    list_raw: order,
    raw: JSON.stringify(order),
    ingest_source: "pull",
    last_ingested_at: ingestedAt,
  };
}

export function selectOrderDevices(
  devices: HuaxinDevice[],
  selectedImeis: string[],
) {
  if (!selectedImeis.length) return { devices, missing: [] as string[] };
  const wanted = new Set(selectedImeis);
  const selected = devices.filter((device) =>
    device.deviceImei && wanted.has(device.deviceImei)
  );
  const found = new Set(selected.map((device) => device.deviceImei));
  return {
    devices: selected,
    missing: selectedImeis.filter((imei) => !found.has(imei)),
  };
}

export function orderSyncStatus(succeeded: number, failed: number) {
  return succeeded > 0 ? failed > 0 ? "partial" : "succeeded" : "failed";
}
