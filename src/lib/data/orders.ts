import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, listDevices, listOrders } from "@/lib/huaxin/client";
import type { Source } from "./machines";

export type Order = {
  id: string;
  order_time: string;
  machine_name: string | null;
  device_imei: string | null;
  order_code: string;
  order_state: string;
  price: number;
  product_name: string;
};

const SAMPLE: Order[] = [
  { id: "1", order_time: "2026-07-01T09:14:00Z", machine_name: "B84MAX-001", device_imei: "867395075018172", order_code: "8692580324200221781047652187", order_state: "COMPLETE", price: 4.5, product_name: "Soft Serve · Oreo, Rainbow" },
  { id: "2", order_time: "2026-07-01T09:02:00Z", machine_name: "B84MAX-002", device_imei: "867395075018173", order_code: "8692580324200221781047652190", order_state: "COMPLETE", price: 3.8, product_name: "Yoghurt · Hazelnut" },
  { id: "3", order_time: "2026-07-01T08:41:00Z", machine_name: "B84MAX-001", device_imei: "867395075018172", order_code: "8692580324200221781047652203", order_state: "PAID", price: 4.5, product_name: "Soft Serve · Chocolate" },
  { id: "4", order_time: "2026-07-01T08:15:00Z", machine_name: "B84MAX-003", device_imei: "867395075018174", order_code: "8692580324200221781047652217", order_state: "FAILURE", price: 0, product_name: "Soft Serve · Oreo" },
];

const STATE_MAP: Record<string, string> = {
  "0": "PENDING",
  "1": "PAID",
  "2": "MAKING",
  "3": "COMPLETE",
};

async function getOrdersLive(): Promise<Order[]> {
  const cfg = getConfigFromEnv();
  if (!cfg) return [];
  const devices = await listDevices(cfg);
  const out: Order[] = [];
  for (const d of devices) {
    if (!d.deviceImei) continue;
    const machineName = (d.deviceLabel as string) || d.deviceName || d.deviceImei;
    const ords = await listOrders(cfg, d.deviceImei);
    for (const o of ords) {
      out.push({
        id: o.orderCode ?? `${d.deviceImei}-${Math.random()}`,
        order_time: o.createTime ?? o.payTime ?? new Date().toISOString(),
        machine_name: machineName,
        device_imei: d.deviceImei,
        order_code: o.orderCode ?? "",
        order_state: STATE_MAP[String(o.status)] ?? String(o.status ?? ""),
        price: Number(o.price ?? 0),
        product_name: o.productName ?? "",
      });
    }
  }
  return out
    .sort((a, b) => +new Date(b.order_time) - +new Date(a.order_time))
    .slice(0, 50);
}

export async function getOrders(): Promise<{ orders: Order[]; source: Source }> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServiceClient();
      const { data, error } = await supabase
        .from("v_orders")
        .select("*")
        .order("order_time", { ascending: false })
        .limit(50);
      if (!error && data && data.length) return { orders: data as Order[], source: "supabase" };
    } catch {
      /* fall through */
    }
  }
  try {
    const live = await getOrdersLive();
    if (live.length) return { orders: live, source: "huaxin" };
  } catch (e) {
    console.error("[orders] Huaxin live failed:", e);
  }
  return { orders: SAMPLE, source: "sample" };
}
