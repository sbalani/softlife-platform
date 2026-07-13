import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, listDevices, listAllOrders, type HuaxinOrder } from "@/lib/huaxin/client";
import { translatePayType, isServerModeOrder, isAdminOverride } from "@/lib/i18n/huaxin";
import type { Source } from "./machines";

export type OrderProduct = { goodsName: string; price: string; position: number };

export type Order = {
  id: string;
  order_time: string;
  machine_name: string | null;
  device_imei: string | null;
  order_code: string;
  out_trade_no: string | null;
  order_state: string;
  status_code: string;
  price: number;
  market_price: number | null;
  discount_price: number | null;
  re_price: number | null;
  product_name: string;
  products: OrderProduct[];
  nums: number;
  amount: number;
  pay_type_raw: string | null;
  pay_type: string | null;
  is_server_mode: boolean;
  is_admin_override: boolean;
  machine_collected: number;
  franchisee_owed: number;
  pay_time: string | null;
  create_time_utc: string | null;
  refund_status: string | null;
  refund_out_no: string | null;
  coupon_used: boolean;
  activity_name: string | null;
  device_label: string | null;
};

const SAMPLE: Order[] = [];

const STATE_MAP: Record<string, string> = { "0": "PENDING", "1": "PAID", "2": "MAKING", "3": "COMPLETE" };
const REFUND_MAP: Record<string, string> = { "0": "None", "1": "Refunded" };

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function mapHuaxinOrder(o: HuaxinOrder, machineName: string, deviceImei: string): Order {
  const products: OrderProduct[] = (o.products as unknown as OrderProduct[]) ?? [];
  const payTypeRaw = (o.payType as string) ?? null;
  const serverMode = isServerModeOrder(payTypeRaw);
  const adminOverride = isAdminOverride(payTypeRaw);
  const price = Number(o.price ?? 0);
  return {
    id: o.orderCode ?? `${deviceImei}-${Math.random()}`,
    order_time: o.createTime ?? o.localPayTime ?? new Date().toISOString(),
    machine_name: machineName,
    device_imei: deviceImei,
    order_code: o.orderCode ?? "",
    out_trade_no: (o.outTradeNo as string) ?? null,
    order_state: STATE_MAP[String(o.status)] ?? String(o.status ?? ""),
    status_code: String(o.status ?? ""),
    price,
    market_price: o.marketPrice != null ? Number(o.marketPrice) : null,
    discount_price: o.discountPrice != null ? Number(o.discountPrice) : null,
    re_price: o.rePrice != null ? Number(o.rePrice) : null,
    product_name: products[0]?.goodsName ?? (o.goodsName as string) ?? "",
    products,
    nums: Number(o.nums ?? 1),
    amount: Number(o.amount ?? 1),
    pay_type_raw: payTypeRaw,
    pay_type: translatePayType(payTypeRaw),
    is_server_mode: serverMode,
    is_admin_override: adminOverride,
    machine_collected: adminOverride || serverMode ? 0 : price,
    franchisee_owed: serverMode ? price : 0,
    pay_time: (o.localPayTime as string) ?? (o.payTime as string) ?? null,
    create_time_utc: (o.createTimeUtc as string) ?? null,
    refund_status: REFUND_MAP[String(o.refundStatus ?? "0")] ?? String(o.refundStatus ?? ""),
    refund_out_no: (o.refundOutNo as string) ?? null,
    coupon_used: ((o.coupon as { result?: boolean })?.result) === true,
    activity_name: (o.activityName as string) ?? null,
    device_label: (o.deviceLabel as string) ?? null,
  };
}

/** v_orders only carries what the webhook receiver actually stores per order
 *  (order_code, price, product_name, state, timestamps) — not the richer
 *  product/coupon/refund breakdown the live Huaxin list API returns. Map
 *  honestly instead of casting the row straight to Order, which crashed on
 *  any field the view doesn't have (e.g. `products`). */
function orderFromSupabaseRow(row: Record<string, unknown>): Order {
  const price = Number(row.price ?? 0);
  // The webhook stores raw numeric status codes ("3"), not names — normalize
  // so state filters/revenue math treat cached rows the same as live ones.
  const rawState = String(row.order_state ?? "");
  return {
    id: row.id as string,
    order_time: (row.order_time as string) ?? new Date().toISOString(),
    machine_name: (row.machine_name as string) ?? null,
    device_imei: (row.device_imei as string) ?? null,
    order_code: (row.order_code as string) ?? "",
    out_trade_no: null,
    order_state: STATE_MAP[rawState] ?? rawState,
    status_code: "",
    price,
    market_price: null,
    discount_price: null,
    re_price: null,
    product_name: (row.product_name as string) ?? "",
    products: [],
    nums: 1,
    amount: Number(row.amount ?? 1),
    pay_type_raw: null,
    pay_type: null,
    is_server_mode: false,
    is_admin_override: false,
    machine_collected: price,
    franchisee_owed: 0,
    pay_time: null,
    create_time_utc: null,
    refund_status: null,
    refund_out_no: null,
    coupon_used: false,
    activity_name: null,
    device_label: null,
  };
}

async function getOrdersLive(): Promise<Order[]> {
  const cfg = getConfigFromEnv();
  if (!cfg) return [];
  const devices = await listDevices(cfg);
  const began = ymd(new Date(Date.now() - 30 * 86_400_000)) + " 00:00:00";
  const end = ymd(new Date()) + " 23:59:59";
  const out: Order[] = [];
  for (const d of devices) {
    if (!d.deviceImei) continue;
    const machineName = (d.deviceLabel as string) || d.deviceName || d.deviceImei;
    try {
      const ords = await listAllOrders(cfg, d.deviceImei, began, end);
      for (const o of ords) {
        out.push(mapHuaxinOrder(o, machineName, d.deviceImei));
      }
    } catch (e) {
      console.error(`[orders] Failed for device ${d.deviceImei}:`, e);
    }
  }
  return out.sort((a, b) => +new Date(b.order_time) - +new Date(a.order_time)).slice(0, 100);
}

export async function getOrders(filters?: {
  machine?: string;
  minPrice?: number;
  maxPrice?: number;
  couponOnly?: boolean;
  refundedOnly?: boolean;
  serverModeOnly?: boolean;
}): Promise<{ orders: Order[]; source: Source }> {
  // Live Huaxin is the primary source: the Supabase cache only holds orders
  // whose webhook events happened to arrive, so preferring it hid entire
  // machines' orders. Cache rows the live pull doesn't return (webhook-only
  // events, or a flaky live call for one device) still merge in by order_code.
  let orders: Order[] = [];
  let source: Source = "sample";

  if (getConfigFromEnv()) {
    try {
      orders = await getOrdersLive();
      source = "huaxin";
    } catch (e) {
      console.error("[orders] Huaxin live failed:", e);
    }
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServiceClient();
      const { data, error } = await supabase.from("v_orders").select("*").order("order_time", { ascending: false }).limit(100);
      if (!error && data) {
        const seen = new Set(orders.map((o) => o.order_code));
        const cacheRows = (data as Record<string, unknown>[]).map(orderFromSupabaseRow).filter((o) => !seen.has(o.order_code));
        orders = [...orders, ...cacheRows].sort((a, b) => +new Date(b.order_time) - +new Date(a.order_time));
        if (source === "sample" && orders.length) source = "supabase";
      }
    } catch {
      /* cache merge is best-effort */
    }
  }

  if (source === "sample" && !orders.length) {
    return { orders: SAMPLE, source: "sample" };
  }

  // Apply filters
  let filtered = orders;
  if (filters?.machine) {
    const q = filters.machine.toLowerCase();
    filtered = filtered.filter((o) => (o.machine_name ?? "").toLowerCase().includes(q) || (o.device_imei ?? "").includes(q));
  }
  if (filters?.minPrice != null) filtered = filtered.filter((o) => o.price >= filters.minPrice!);
  if (filters?.maxPrice != null) filtered = filtered.filter((o) => o.price <= filters.maxPrice!);
  if (filters?.couponOnly) filtered = filtered.filter((o) => o.coupon_used);
  if (filters?.refundedOnly) filtered = filtered.filter((o) => o.refund_status === "Refunded");
  if (filters?.serverModeOnly) filtered = filtered.filter((o) => o.is_server_mode);

  return { orders: filtered, source };
}
