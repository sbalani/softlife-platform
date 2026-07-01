import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Machine = {
  id: string;
  name: string;
  ref: string | null;
  device_imei: string | null;
  customer: string | null;
  warehouse: string | null;
  state: string;
  base_product: string | null;
  last_full_clean_date: string | null;
  ingredient_count: number;
  latest_temp: number | null;
  created_at: string | null;
  net_online: boolean;
};

const SAMPLE: Machine[] = [
  {
    id: "101",
    name: "B84MAX-001",
    ref: "SL-001",
    device_imei: "867395075018172",
    customer: "Cafetería Centro",
    warehouse: "Madrid Central",
    state: "active",
    base_product: "Base Vainilla",
    last_full_clean_date: "2026-06-18T08:00:00Z",
    ingredient_count: 3,
    latest_temp: -4.2,
    created_at: "2026-01-15T09:00:00Z",
    net_online: true,
  },
  {
    id: "102",
    name: "B84MAX-002",
    ref: "SL-002",
    device_imei: "867395075018173",
    customer: "Cafetería Centro",
    warehouse: "Madrid Central",
    state: "active",
    base_product: "Base Yoghurt",
    last_full_clean_date: "2026-06-21T07:30:00Z",
    ingredient_count: 2,
    latest_temp: -3.8,
    created_at: "2026-02-02T09:00:00Z",
    net_online: true,
  },
  {
    id: "103",
    name: "B84MAX-003",
    ref: "SL-003",
    device_imei: "867395075018174",
    customer: "Hotel Mar",
    warehouse: "Costa Depot",
    state: "active",
    base_product: "Base Vainilla",
    last_full_clean_date: "2026-06-10T09:15:00Z",
    ingredient_count: 3,
    latest_temp: null,
    created_at: "2026-03-21T09:00:00Z",
    net_online: false,
  },
];

export async function getMachines(): Promise<{
  machines: Machine[];
  source: "supabase" | "sample";
}> {
  if (!isSupabaseConfigured()) return { machines: SAMPLE, source: "sample" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("v_machines")
      .select("*")
      .order("name");
    if (error || !data) return { machines: SAMPLE, source: "sample" };
    return { machines: data as Machine[], source: "supabase" };
  } catch {
    return { machines: SAMPLE, source: "sample" };
  }
}
