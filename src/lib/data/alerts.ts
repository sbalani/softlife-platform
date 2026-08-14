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
};

const SAMPLE: Alert[] = [
  { id: "a1", type: "machine_refill", severity: "warning", machine_name: "B84MAX-001", product_name: null, title: "Material running low", message: "Base product is at 28%. Schedule a refill.", remaining_pct: 28, created_at: "2026-07-01T08:00:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null, resolved_at: null },
  { id: "a2", type: "warehouse_restock", severity: "critical", machine_name: null, product_name: null, title: "Warehouse stock low", message: "Consigned stock is at 22%. Schedule a restock.", remaining_pct: 22, created_at: "2026-07-01T07:30:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null, resolved_at: null },
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
    if (machineIds) query = query.in("machine_id", machineIds);
    const { data, error } = await query;
    if (error || !data) return machineIds ? { alerts: [], source: "supabase" } : { alerts: resolved ? [] : SAMPLE, source: "sample" };
    return { alerts: data as Alert[], source: "supabase" };
  } catch {
    return machineIds ? { alerts: [], source: "supabase" } : { alerts: resolved ? [] : SAMPLE, source: "sample" };
  }
}
