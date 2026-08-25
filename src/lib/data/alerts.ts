import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Alert = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  machine_name: string | null;
  product_name: string | null;
  title: string;
  message: string;
  remaining_pct: number | null;
  created_at: string;
  change_log_id: string | null;
  device_imei: string | null;
  change_field: string | null;
  entity_key: string | null;
  resolved_at: string | null;
  incident_id: string | null;
  incident_status: "open" | "closed" | null;
};

const SAMPLE: Alert[] = [
  { id: "a1", type: "machine_refill", severity: "warning", machine_name: "B84MAX-001", product_name: null, title: "Material running low", message: "Base product is at 28%. Schedule a refill.", remaining_pct: 28, created_at: "2026-07-01T08:00:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null, resolved_at: null, incident_id: null, incident_status: null },
  { id: "a2", type: "warehouse_restock", severity: "critical", machine_name: null, product_name: null, title: "Warehouse stock low", message: "Consigned stock is at 22%. Schedule a restock.", remaining_pct: 22, created_at: "2026-07-01T07:30:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null, resolved_at: null, incident_id: null, incident_status: null },
];

export async function getAlerts(resolved = false, machineIds?: string[]): Promise<{ alerts: Alert[]; source: "supabase" | "sample" }> {
  if (machineIds?.length === 0) return { alerts: [], source: "supabase" };
  if (!isSupabaseConfigured()) return { alerts: resolved ? [] : SAMPLE, source: "sample" };
  try {
    const supabase = machineIds ? await createServiceClient() : await createClient();
    let query = supabase
      .from("v_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(resolved ? 200 : 50);
    query = resolved ? query.not("resolved_at", "is", null) : query.is("resolved_at", null);
    if (!resolved) query = query.or("machine_id.is.null,machine_deployed.eq.true,type.eq.defrost_automation_failed");
    if (machineIds) query = query.in("machine_id", machineIds);
    const { data, error } = await query;
    if (error || !data) return machineIds ? { alerts: [], source: "supabase" } : { alerts: resolved ? [] : SAMPLE, source: "sample" };
    const rows = data as Omit<Alert, "incident_id" | "incident_status">[];
    const { data: incidentRows } = rows.length ? await (await createClient()).from("incidents").select("id,status,source_alert_id").in("source_alert_id", rows.map((row) => row.id)) : { data: [] };
    const incidents = new Map(((incidentRows as { id: string; status: "open" | "closed"; source_alert_id: string }[]) ?? []).map((incident) => [incident.source_alert_id, incident]));
    return { alerts: rows.map((row) => ({ ...row, incident_id: incidents.get(row.id)?.id ?? null, incident_status: incidents.get(row.id)?.status ?? null })), source: "supabase" };
  } catch {
    return machineIds ? { alerts: [], source: "supabase" } : { alerts: resolved ? [] : SAMPLE, source: "sample" };
  }
}
