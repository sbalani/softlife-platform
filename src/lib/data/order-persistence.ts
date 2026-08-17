import type { HuaxinOrder } from "../huaxin/client.ts";
import { huaxinLocalTimeToUtc, huaxinOrderTime } from "../huaxin/order-time.ts";
import { isAdminOverride, isServerModeOrder, translatePayType } from "../i18n/huaxin.ts";
import { ymd } from "../dates.ts";

type MachineRef = { id: string | null; tenantId: string | null; imei: string };
export type OrderAssignment = { machine_id: string; tenant_id: string; start_date: string; end_date: string | null };
const STATE_MAP: Record<string, string> = { "0": "PENDING", "1": "PAID", "2": "MAKING", "3": "COMPLETE" };
const REFUND_MAP: Record<string, string> = { "0": "None", "1": "Refunded" };

export function tenantForOrder(assignments: OrderAssignment[], machineId: string | null, orderTime: string | null) {
  if (!machineId || !orderTime) return null;
  const day = ymd(new Date(orderTime));
  return assignments
    .filter((assignment) => assignment.machine_id === machineId && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]?.tenant_id ?? null;
}

export function orderRowFromHuaxin(order: HuaxinOrder, machine: MachineRef) {
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
    discount_price: order.discountPrice == null ? null : Number(order.discountPrice),
    re_price: order.rePrice == null ? null : Number(order.rePrice),
    amount: Number(order.amount ?? 1),
    product_name: products[0]?.goodsName ?? order.productName ?? order.goodsName ?? null,
    products,
    nums: Number(order.nums ?? 1),
    pay_type_raw: order.payType ?? null,
    pay_time: huaxinLocalTimeToUtc(order.localPayTime ?? order.payTime),
    create_time_utc: order.createTimeUtc ?? null,
    refund_status: order.refundStatus == null ? null : String(order.refundStatus),
    refund_out_no: order.refundOutNo ?? null,
    coupon_used: order.coupon?.result === true,
    activity_name: order.activityName ?? null,
    device_label: order.deviceLabel ?? null,
    list_raw: order,
    raw: JSON.stringify(order),
    ingest_source: "pull",
    last_ingested_at: new Date().toISOString(),
  };
}

export function orderPatchFromWebhook(body: unknown) {
  const data = (body as { data?: Record<string, unknown> } | null)?.data ?? {};
  const orderCode = String(data.orderCode ?? "").trim();
  if (!orderCode) return null;
  const timestampFields = {
    createTimeUtc: data.createTimeUtc as string | undefined,
    createTime: (data.createTime ?? data.orderTime) as string | undefined,
    localPayTime: data.localPayTime as string | undefined,
    payTime: data.payTime as string | undefined,
  };
  const products = Array.isArray(data.products) ? data.products : null;
  const row: Record<string, unknown> = {
    order_code: orderCode,
    webhook_raw: body,
    raw: JSON.stringify(body),
    ingest_source: "webhook",
    last_ingested_at: new Date().toISOString(),
  };
  if (data.deviceImei != null) row.device_imei = String(data.deviceImei);
  if (data.outTradeNo != null) row.out_trade_no = String(data.outTradeNo);
  if (data.orderState != null || data.status != null) {
    const state = String(data.orderState ?? data.status);
    row.order_state = /^\d+$/.test(state) ? state : state.toUpperCase();
    row.status_code = String(data.status ?? data.orderState);
  }
  const orderTime = huaxinOrderTime(timestampFields);
  if (orderTime) row.order_time = orderTime;
  if (data.price != null) row.price = Number(data.price);
  if (data.marketPrice != null) row.market_price = Number(data.marketPrice);
  if (data.discountPrice != null) row.discount_price = Number(data.discountPrice);
  if (data.rePrice != null) row.re_price = Number(data.rePrice);
  if (data.amount != null) row.amount = Number(data.amount);
  if (data.nums != null) row.nums = Number(data.nums);
  if (products) row.products = products;
  if (data.productName != null || data.goodsName != null || products?.[0]) {
    row.product_name = (products?.[0] as { goodsName?: string } | undefined)?.goodsName ?? data.productName ?? data.goodsName;
  }
  if (data.payType != null) row.pay_type_raw = String(data.payType);
  const payTime = huaxinLocalTimeToUtc((data.localPayTime ?? data.payTime) as string | undefined);
  if (payTime) row.pay_time = payTime;
  if (data.createTimeUtc != null) row.create_time_utc = String(data.createTimeUtc);
  if (data.refundStatus != null) row.refund_status = String(data.refundStatus);
  if (data.refundOutNo != null) row.refund_out_no = String(data.refundOutNo);
  if (data.coupon != null) row.coupon_used = (data.coupon as { result?: boolean }).result === true;
  if (data.activityName != null) row.activity_name = String(data.activityName);
  if (data.deviceLabel != null) row.device_label = String(data.deviceLabel);
  if (data.detail != null) row.detail_raw = String(data.detail);
  return row;
}

export function storedOrderFromRow(row: Record<string, unknown>) {
  const price = Number(row.price ?? 0);
  const rawState = String(row.order_state ?? "");
  const statusCode = String(row.status_code ?? rawState);
  const products = Array.isArray(row.products) ? row.products : [];
  const payTypeRaw = (row.pay_type_raw as string) ?? null;
  const serverMode = isServerModeOrder(payTypeRaw);
  const adminOverride = isAdminOverride(payTypeRaw);
  const rawRefund = row.refund_status == null ? null : String(row.refund_status);
  return {
    id: row.id as string,
    order_time: (row.order_time as string) ?? new Date().toISOString(),
    machine_name: (row.machine_name as string) ?? null,
    device_imei: (row.device_imei as string) ?? null,
    order_code: (row.order_code as string) ?? "",
    out_trade_no: (row.out_trade_no as string) ?? null,
    order_state: STATE_MAP[statusCode] ?? STATE_MAP[rawState] ?? rawState,
    status_code: statusCode,
    price,
    market_price: row.market_price == null ? null : Number(row.market_price),
    discount_price: row.discount_price == null ? null : Number(row.discount_price),
    re_price: row.re_price == null ? null : Number(row.re_price),
    product_name: (row.product_name as string) ?? "",
    products,
    nums: Number(row.nums ?? 1),
    amount: Number(row.amount ?? 1),
    pay_type_raw: payTypeRaw,
    pay_type: translatePayType(payTypeRaw),
    is_server_mode: serverMode,
    is_admin_override: adminOverride,
    machine_collected: adminOverride || serverMode ? 0 : price,
    franchisee_owed: serverMode ? price : 0,
    pay_time: (row.pay_time as string) ?? null,
    create_time_utc: (row.create_time_utc as string) ?? null,
    refund_status: rawRefund == null ? null : REFUND_MAP[rawRefund] ?? rawRefund,
    refund_out_no: (row.refund_out_no as string) ?? null,
    coupon_used: Boolean(row.coupon_used),
    activity_name: (row.activity_name as string) ?? null,
    device_label: (row.device_label as string) ?? null,
  };
}
