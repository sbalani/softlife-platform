import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, listDevices, listOrders, type HuaxinOrder } from "@/lib/huaxin/client";
import type { Source } from "./machines";

export type OrderProduct = { goodsName: string; price: string; position: number };
export type OrderCoupon = { result: boolean; couponName?: string; couponType?: string };

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
  pay_type: string | null;
  pay_time: string | null;
  create_time_utc: string | null;
  refund_status: string | null;
  refund_out_no: string | null;
  coupon_used: boolean;
  coupon_detail: OrderCoupon | null;
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
  return {
    id: o.orderCode ?? `${deviceImei}-${Math.random()}`,
    order_time: o.createTime ?? o.localPayTime ?? new Date().toISOString(),
    machine_name: machineName,
    device_imei: deviceImei,
    order_code: o.orderCode ?? "",
    out_trade_no: (o.outTradeNo as string) ?? null,
    order_state: STATE_MAP[String(o.status)] ?? String(o.status ?? ""),
    status_code: String(o.status ?? ""),
    price: Number(o.price ?? 0),
    market_price: o.marketPrice != null ? Number(o.marketPrice) : null,
    discount_price: o.discountPrice != null ? Number(o.discountPrice) : null,
    re_price: o.rePrice != null ? Number(o.rePrice) : null,
    product_name: products[0]?.goodsName ?? (o.goodsName as string) ?? "",
    products,
    nums: Number(o.nums ?? 1),
    amount: Number(o.amount ?? 1),
    pay_type: (o.payType as string) ?? null,
    pay_time: (o.localPayTime as string) ?? (o.payTime as string) ?? null,
    create_time_utc: (o.createTimeUtc as string) ?? null,
    refund_status: REFUND_MAP[String(o.refundStatus ?? "0")] ?? String(o.refundStatus ?? ""),
    refund_out_no: (o.refundOutNo as string) ?? null,
    coupon_used: ((o.coupon as { result?: boolean })?.result) === true,
    coupon_detail: (o.coupon as OrderCoupon) ?? null,
    activity_name: (o.activityName as string) ?? null,
    device_label: (o.deviceLabel as string) ?? null,
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
    const ords = await listOrders(cfg, d.deviceImei, began, end);
    for (const o of ords) {
      out.push(mapHuaxinOrder(o, machineName, d.deviceImei));
    }
  }
  return out.sort((a, b) => +new Date(b.order_time) - +new Date(a.order_time)).slice(0, 100);
}

export async function getOrders(filters?: {
  machine?: string;
  productType?: string;
  minPrice?: number;
  maxPrice?: number;
  couponOnly?: boolean;
  refundedOnly?: boolean;
}): Promise<{ orders: Order[]; source: Source }> {
  let orders: Order[] = [];
  let source: Source = "sample";

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServiceClient();
      const { data, error } = await supabase.from("v_orders").select("*").order("order_time", { ascending: false }).limit(100);
      if (!error && data && data.length) {
        orders = data as Order[];
        source = "supabase";
      }
    } catch {
      /* fall through */
    }
  }

  if (source === "sample" && getConfigFromEnv()) {
    try {
      orders = await getOrdersLive();
      source = "huaxin";
    } catch (e) {
      console.error("[orders] Huaxin live failed:", e);
      return { orders: [], source: "huaxin" };
    }
  }

  if (source === "sample" && !getConfigFromEnv()) {
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

  return { orders: filtered, source };
}
