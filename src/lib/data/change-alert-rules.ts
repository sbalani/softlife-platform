import { createServiceClient } from "@/lib/supabase/server";

export type ChangeAlertRule = {
  id: string;
  name: string;
  field: string;
  machine_id: string | null;
  machine_name: string | null;
  min_value: number | null;
  max_value: number | null;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
};

export async function getChangeAlertRules(): Promise<ChangeAlertRule[]> {
  const s = await createServiceClient();
  const { data, error } = await s.from("change_alert_rules").select("*, machines(name)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    field: row.field as string,
    machine_id: (row.machine_id as string) ?? null,
    machine_name: ((row.machines as { name?: string } | null)?.name) ?? null,
    min_value: row.min_value == null ? null : Number(row.min_value),
    max_value: row.max_value == null ? null : Number(row.max_value),
    severity: row.severity as ChangeAlertRule["severity"],
    enabled: Boolean(row.enabled),
  }));
}
