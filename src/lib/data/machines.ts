import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { translateLocation } from "@/lib/i18n/huaxin";
import { fleetFreshness } from "@/lib/data/fleet-freshness";

export type Machine = {
  id: string;
  name: string;
  ref: string | null;
  device_imei: string | null;
  location: string | null;
  location_override?: string | null;
  latitude: number | null;
  longitude: number | null;
  customer: string | null;
  warehouse: string | null;
  state: string;
  base_product: string | null;
  last_full_clean_date: string | null;
  ingredient_count: number;
  latest_temp: number | null;
  created_at: string | null;
  net_online: boolean;
  huaxin_last_sync: string | null;
};

export type Source = "supabase" | "huaxin" | "sample";

export async function getMachines(): Promise<{
  machines: Machine[];
  source: "supabase";
  lastSyncedAt: string | null;
  staleMachines: number;
  readError?: string;
}> {
  if (!isSupabaseConfigured()) return { machines: [], source: "supabase", lastSyncedAt: null, staleMachines: 0, readError: "Supabase is not configured." };
  try {
    const s = await createServiceClient();
    const rows: Machine[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await s.from("v_machines").select("*").order("name").order("id").range(offset, offset + 999);
      if (error) throw error;
      rows.push(...((data as Machine[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    const machines = rows.map((machine) => ({ ...machine, location: machine.location_override || translateLocation(machine.location) }));
    const freshness = fleetFreshness(machines.map((machine) => machine.huaxin_last_sync));
    return {
      machines,
      source: "supabase",
      lastSyncedAt: freshness.latest,
      staleMachines: freshness.stale,
    };
  } catch (error) {
    console.error("[machines] Supabase read failed:", error);
    return { machines: [], source: "supabase", lastSyncedAt: null, staleMachines: 0, readError: error instanceof Error ? error.message : String(error) };
  }
}
