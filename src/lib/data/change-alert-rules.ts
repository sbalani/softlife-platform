import { createServiceClient } from "@/lib/supabase/server";

export type ChangeAlertRule = {
  id: string;
  name: string;
  field: string;
  machine_id: string | null;
  machine_name: string | null;
  product_id: string | null;
  product_name: string | null;
  rule_type: "numeric_range" | "status_equals";
  target_value: string | null;
  min_value: number | null;
  max_value: number | null;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
};

export async function getChangeAlertRules(): Promise<ChangeAlertRule[]> {
  const s = await createServiceClient();
  const { data, error } = await s.from("change_alert_rules").select("*, machines(name), products(name)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    field: row.field as string,
    machine_id: (row.machine_id as string) ?? null,
    machine_name: ((row.machines as { name?: string } | null)?.name) ?? null,
    product_id: (row.product_id as string) ?? null,
    product_name: ((row.products as { name?: string } | null)?.name) ?? null,
    rule_type: row.rule_type as ChangeAlertRule["rule_type"],
    target_value: (row.target_value as string) ?? null,
    min_value: row.min_value == null ? null : Number(row.min_value),
    max_value: row.max_value == null ? null : Number(row.max_value),
    severity: row.severity as ChangeAlertRule["severity"],
    enabled: Boolean(row.enabled),
  }));
}
