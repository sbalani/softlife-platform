import type { SessionProfile } from "@/lib/auth/session";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Incident = {
  id: string;
  machineId: string;
  machineName: string;
  machineImei: string | null;
  incidentType: string;
  typeLabel: string;
  sourceKind: "alert" | "schedule" | "manual";
  sourceAlertId: string | null;
  sourceAlertResolvedAt: string | null;
  title: string;
  description: string | null;
  severity: "info" | "warning" | "critical";
  status: "open" | "closed";
  assignedTenantId: string | null;
  assignedTenantName: string | null;
  dueAt: string | null;
  openedAt: string;
  closedAt: string | null;
  closureKind: "action_report" | "no_report" | null;
  closingActionReportId: string | null;
};

export type IncidentPolicy = {
  incidentType: string;
  label: string;
  autoAssignToFranchisee: boolean;
};

function presentIncident(row: Record<string, unknown>): Incident {
  const machine = row.machines as { name?: string; display_name?: string | null; device_imei?: string | null } | null;
  const tenant = row.tenants as { name?: string } | null;
  const policy = row.incident_type_policies as { label?: string } | null;
  return {
    id: row.id as string,
    machineId: row.machine_id as string,
    machineName: machine?.display_name || machine?.name || "Unknown machine",
    machineImei: machine?.device_imei ?? null,
    incidentType: row.incident_type as string,
    typeLabel: policy?.label || String(row.incident_type).replaceAll("_", " "),
    sourceKind: row.source_kind as Incident["sourceKind"],
    sourceAlertId: row.source_alert_id as string | null,
    sourceAlertResolvedAt: row.source_alert_resolved_at as string | null,
    title: row.title as string,
    description: row.description as string | null,
    severity: row.severity as Incident["severity"],
    status: row.status as Incident["status"],
    assignedTenantId: row.assigned_tenant_id as string | null,
    assignedTenantName: tenant?.name ?? null,
    dueAt: row.due_at as string | null,
    openedAt: row.opened_at as string,
    closedAt: row.closed_at as string | null,
    closureKind: row.closure_kind as Incident["closureKind"],
    closingActionReportId: row.closing_action_report_id as string | null,
  };
}

export async function getIncidents(session: SessionProfile, options: { machineIds?: string[]; status?: "open" | "closed" } = {}): Promise<Incident[]> {
  if (!isSupabaseConfigured() || session.role === "operator" || options.machineIds?.length === 0) return [];
  const s = await createServiceClient();
  if (session.role === "franchisee" && !session.tenant_id) return [];
  const rows: Record<string, unknown>[] = [];
  const pageSize = options.status === "closed" ? 200 : 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = s.from("incidents")
      .select("id,machine_id,incident_type,source_kind,source_alert_id,source_alert_resolved_at,title,description,severity,status,assigned_tenant_id,due_at,opened_at,closed_at,closure_kind,closing_action_report_id,machines(name,display_name,device_imei),tenants(name),incident_type_policies(label)")
      .order(options.status === "closed" ? "closed_at" : "opened_at", { ascending: false }).range(offset, offset + pageSize - 1);
    if (options.status) query = query.eq("status", options.status);
    if (options.machineIds) query = query.in("machine_id", options.machineIds);
    if (session.role === "franchisee") query = query.eq("assigned_tenant_id", session.tenant_id!);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data as Record<string, unknown>[]) ?? []));
    if (!data || data.length < pageSize || options.status === "closed") break;
  }
  return rows.map(presentIncident);
}

export async function getIncidentPolicies(): Promise<IncidentPolicy[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await (await createServiceClient()).from("incident_type_policies")
    .select("incident_type,label,auto_assign_to_franchisee").order("label");
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    incidentType: row.incident_type as string,
    label: row.label as string,
    autoAssignToFranchisee: Boolean(row.auto_assign_to_franchisee),
  }));
}
