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
  deployed: boolean;
  base_product: string | null;
  last_full_clean_date: string | null;
  ingredient_count: number;
  latest_temp: number | null;
  created_at: string | null;
  net_online: boolean;
  huaxin_last_sync: string | null;
  last_online_at: string | null;
  offline_since: string | null;
  oos: boolean;
  low_stock: boolean;
  active_alert_count: number;
  open_incident_count: number;
  open_refill_incident: boolean;
  last_refill_at: string | null;
  status_observed_at: string | null;
};

export type Source = "supabase" | "huaxin" | "sample";

export async function getMachines(machineIds?: string[]): Promise<{
  machines: Machine[];
  source: "supabase";
  lastSyncedAt: string | null;
  staleMachines: number;
  readError?: string;
}> {
  if (!isSupabaseConfigured()) return { machines: [], source: "supabase", lastSyncedAt: null, staleMachines: 0, readError: "Supabase is not configured." };
  if (machineIds?.length === 0) return { machines: [], source: "supabase", lastSyncedAt: null, staleMachines: 0 };
  try {
    const s = await createServiceClient();
    const rows: Machine[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = s.from("v_machines").select("*");
      if (machineIds) query = query.in("id", machineIds);
      const { data, error } = await query.order("name").order("id").range(offset, offset + 999);
      if (error) throw error;
      rows.push(...((data as Machine[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    let namesQuery = s.from("machines").select("id,display_name,deployed,last_refill_at");
    let statusesQuery = s.from("machine_status_snapshots").select("machine_id,field,value,observed_at").in("field", ["cup_empty", "material_empty", "material_out"]);
    let alertsQuery = s.from("v_alerts").select("machine_id,change_field").is("resolved_at", null);
    let incidentsQuery = s.from("incidents").select("machine_id,incident_type").in("status", ["open", "in_progress"]);
    if (machineIds) {
      namesQuery = namesQuery.in("id", machineIds);
      statusesQuery = statusesQuery.in("machine_id", machineIds);
      alertsQuery = alertsQuery.in("machine_id", machineIds);
      incidentsQuery = incidentsQuery.in("machine_id", machineIds);
    }
    const [{ data: names, error: namesError }, { data: statuses, error: statusesError }, { data: alerts, error: alertsError }, { data: incidents, error: incidentsError }] = await Promise.all([namesQuery, statusesQuery, alertsQuery, incidentsQuery]);
    if (namesError) throw namesError;
    if (statusesError) throw statusesError;
    if (alertsError) throw alertsError;
    if (incidentsError) throw incidentsError;
    const machineMetadata = new Map(((names as { id: string; display_name: string | null; last_refill_at: string | null }[]) ?? []).map((row) => [row.id, row]));
    const statusRows = (statuses as { machine_id: string; field: string; value: unknown; observed_at: string }[]) ?? [];
    const activeStatuses = statusRows.filter((row) => row.value === true || row.value === "true");
    const oosMachines = new Set(activeStatuses.filter((row) => row.field === "cup_empty" || row.field === "material_out").map((row) => row.machine_id));
    const lowStockMachines = new Set(activeStatuses.filter((row) => row.field === "material_empty").map((row) => row.machine_id));
    const statusTimes = new Map<string, string>();
    for (const row of statusRows) if (!statusTimes.has(row.machine_id) || row.observed_at > statusTimes.get(row.machine_id)!) statusTimes.set(row.machine_id, row.observed_at);
    const alertCounts = new Map<string, number>();
    for (const alert of (alerts as { machine_id: string | null; change_field: string | null }[]) ?? []) {
      if (!alert.machine_id || alert.change_field === "cup_empty" || alert.change_field === "material_empty") continue;
      alertCounts.set(alert.machine_id, (alertCounts.get(alert.machine_id) ?? 0) + 1);
    }
    const incidentCounts = new Map<string, number>();
    const refillIncidents = new Set<string>();
    for (const incident of (incidents as { machine_id: string; incident_type: string }[]) ?? []) {
      incidentCounts.set(incident.machine_id, (incidentCounts.get(incident.machine_id) ?? 0) + 1);
      if (incident.incident_type === "scheduled_refill") refillIncidents.add(incident.machine_id);
    }
    const machines = rows.map((machine) => ({
      ...machine,
      display_name: machineMetadata.get(machine.id)?.display_name ?? null,
      location: machine.location_override || translateLocation(machine.location),
      oos: machine.deployed && oosMachines.has(machine.id),
      low_stock: machine.deployed && lowStockMachines.has(machine.id) && !oosMachines.has(machine.id),
      active_alert_count: machine.deployed ? alertCounts.get(machine.id) ?? 0 : 0,
      open_incident_count: incidentCounts.get(machine.id) ?? 0,
      open_refill_incident: machine.deployed && refillIncidents.has(machine.id),
      last_refill_at: machineMetadata.get(machine.id)?.last_refill_at ?? null,
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
