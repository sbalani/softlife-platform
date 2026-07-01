import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

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

export async function getOrders(): Promise<{ orders: Order[]; source: "supabase" | "sample" }> {
  if (!isSupabaseConfigured()) return { orders: SAMPLE, source: "sample" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("v_orders")
      .select("*")
      .order("order_time", { ascending: false })
      .limit(50);
    if (error || !data) return { orders: SAMPLE, source: "sample" };
    return { orders: data as Order[], source: "supabase" };
  } catch {
    return { orders: SAMPLE, source: "sample" };
  }
}
