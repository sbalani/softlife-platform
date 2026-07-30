import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Alert = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  machine_name: string | null;
  message: string;
  remaining_pct: number | null;
  created_at: string;
  change_log_id: string | null;
  device_imei: string | null;
  change_field: string | null;
  entity_key: string | null;
};

const SAMPLE: Alert[] = [
  { id: "a1", type: "machine_refill", severity: "warning", machine_name: "B84MAX-001", message: "Líquido base al 28% — programar reposición.", remaining_pct: 28, created_at: "2026-07-01T08:00:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null },
  { id: "a2", type: "warehouse_restock", severity: "critical", machine_name: null, message: "Stock consignado al 22% — generar reposición a socio.", remaining_pct: 22, created_at: "2026-07-01T07:30:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null },
  { id: "a3", type: "recall", severity: "critical", machine_name: "B84MAX-003", message: "Lote LOT-2026-0615 afectado — retirar máquina.", remaining_pct: null, created_at: "2026-06-30T18:00:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null },
  { id: "a4", type: "calibration", severity: "info", machine_name: "B84MAX-002", message: "Calibración de sensor pendiente (7 días).", remaining_pct: null, created_at: "2026-06-29T10:00:00Z", change_log_id: null, device_imei: null, change_field: null, entity_key: null },
];

export async function getAlerts(): Promise<{ alerts: Alert[]; source: "supabase" | "sample" }> {
  if (!isSupabaseConfigured()) return { alerts: SAMPLE, source: "sample" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("v_alerts")
      .select("*")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return { alerts: SAMPLE, source: "sample" };
    return { alerts: data as Alert[], source: "supabase" };
  } catch {
    return { alerts: SAMPLE, source: "sample" };
  }
}
