import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { translateLocation } from "@/lib/i18n/huaxin";
import { fleetFreshness } from "@/lib/data/fleet-freshness";

export type Machine = {
  id: string;
  name: string;
  display_name: string | null;
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
  oos: boolean;
  active_alert_count: number;
  status_observed_at: string | null;
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
    const [{ data: names, error: namesError }, { data: statuses, error: statusesError }, { data: alerts, error: alertsError }] = await Promise.all([
      s.from("machines").select("id,display_name"),
      s.from("machine_status_snapshots").select("machine_id,field,value,observed_at").in("field", ["cup_empty", "material_empty"]),
      s.from("v_alerts").select("machine_id,change_field").is("resolved_at", null),
    ]);
    if (namesError) throw namesError;
    if (statusesError) throw statusesError;
    if (alertsError) throw alertsError;
    const displayNames = new Map(((names as { id: string; display_name: string | null }[]) ?? []).map((row) => [row.id, row.display_name]));
    const statusRows = (statuses as { machine_id: string; value: unknown; observed_at: string }[]) ?? [];
    const oosMachines = new Set(statusRows.filter((row) => row.value === true || row.value === "true").map((row) => row.machine_id));
    const statusTimes = new Map<string, string>();
    for (const row of statusRows) if (!statusTimes.has(row.machine_id) || row.observed_at > statusTimes.get(row.machine_id)!) statusTimes.set(row.machine_id, row.observed_at);
    const alertCounts = new Map<string, number>();
    for (const alert of (alerts as { machine_id: string | null; change_field: string | null }[]) ?? []) {
      if (!alert.machine_id || alert.change_field === "cup_empty" || alert.change_field === "material_empty") continue;
      alertCounts.set(alert.machine_id, (alertCounts.get(alert.machine_id) ?? 0) + 1);
    }
    const machines = rows.map((machine) => ({
      ...machine,
      display_name: displayNames.get(machine.id) ?? null,
      location: machine.location_override || translateLocation(machine.location),
      oos: oosMachines.has(machine.id),
      active_alert_count: alertCounts.get(machine.id) ?? 0,
      status_observed_at: statusTimes.get(machine.id) ?? null,
    }));
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
