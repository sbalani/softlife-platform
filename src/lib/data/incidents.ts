import type { SessionProfile } from "@/lib/auth/session";
import { accessibleMachineIds } from "@/lib/data/service-access";
import { incidentAccessFilter, incidentStatusesForView, type IncidentWorkflowStatus } from "@/lib/incident-workflow";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type IncidentStatus = IncidentWorkflowStatus;

export type IncidentEvent = {
  id: string;
  type: "created" | "alert_updated" | "assigned" | "started" | "resolved" | "reopened" | "action_report_linked";
  actorName: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  message: string | null;
  createdAt: string;
};

export type Incident = {
  id: string;
  scopeKind: "machine" | "warehouse" | "location";
  machineId: string | null;
  machineName: string | null;
  machineImei: string | null;
  warehouseId: number | null;
  warehouseName: string | null;
  locationText: string | null;
  incidentType: string;
  typeLabel: string;
  sourceKind: "alert" | "schedule" | "manual";
  sourceAlertId: string | null;
  sourceAlertResolvedAt: string | null;
  title: string;
  description: string | null;
  severity: "info" | "warning" | "critical";
  status: IncidentStatus;
  owningTenantId: string | null;
  owningTenantName: string | null;
  assignedTenantId: string | null;
  assignedTenantName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  dueAt: string | null;
  openedAt: string;
  resolvedAt: string | null;
  resolutionSummary: string | null;
  closureKind: "action_report" | "incident_report" | "no_report" | null;
  closingActionReportId: string | null;
  overdue: boolean;
  events: IncidentEvent[];
};

export type IncidentPolicy = {
  incidentType: string;
  label: string;
  autoAssignToFranchisee: boolean;
};

export type IncidentWorkspaceOptions = {
  machines: { id: string; name: string }[];
  warehouses: { id: number; name: string }[];
  tenants: { id: string; name: string }[];
  users: { id: string; name: string; tenantId: string | null; tenantName: string | null }[];
};

function relation(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
}

function presentIncident(row: Record<string, unknown>, events: IncidentEvent[]): Incident {
  const machine = relation(row, "machines");
  const warehouse = relation(row, "odoo_warehouses");
  const owner = relation(row, "owning_tenant");
  const tenant = relation(row, "assigned_tenant");
  const user = relation(row, "assigned_user");
  const policy = relation(row, "incident_type_policies");
  return {
    id: row.id as string,
    scopeKind: row.scope_kind as Incident["scopeKind"],
    machineId: row.machine_id as string | null,
    machineName: machine ? String(machine.display_name || machine.name || "Unknown machine") : null,
    machineImei: (machine?.device_imei as string) ?? null,
    warehouseId: row.odoo_warehouse_id as number | null,
    warehouseName: (warehouse?.name as string) ?? null,
    locationText: row.location_text as string | null,
    incidentType: row.incident_type as string,
    typeLabel: (policy?.label as string) || String(row.incident_type).replaceAll("_", " "),
    sourceKind: row.source_kind as Incident["sourceKind"],
    sourceAlertId: row.source_alert_id as string | null,
    sourceAlertResolvedAt: row.source_alert_resolved_at as string | null,
    title: row.title as string,
    description: row.description as string | null,
    severity: row.severity as Incident["severity"],
    status: row.status as IncidentStatus,
    owningTenantId: row.owning_tenant_id as string | null,
    owningTenantName: (owner?.name as string) ?? null,
    assignedTenantId: row.assigned_tenant_id as string | null,
    assignedTenantName: (tenant?.name as string) ?? null,
    assignedUserId: row.assigned_user_id as string | null,
    assignedUserName: user ? String(user.full_name || user.email || "Unnamed user") : null,
    dueAt: row.due_at as string | null,
    openedAt: row.opened_at as string,
    resolvedAt: row.resolved_at as string | null,
    resolutionSummary: row.resolution_summary as string | null,
    closureKind: row.closure_kind as Incident["closureKind"],
    closingActionReportId: row.closing_action_report_id as string | null,
    overdue: Boolean(row.due_at) && Date.parse(row.due_at as string) < Date.now(),
    events,
  };
}

export async function getIncidents(session: SessionProfile, options: { machineIds?: string[]; status?: "open" | "resolved" | "closed" } = {}): Promise<Incident[]> {
  if (!isSupabaseConfigured() || options.machineIds?.length === 0) return [];
  if (session.role === "franchisee" && !session.tenant_id) return [];
  const s = await createServiceClient();
  const rows: Record<string, unknown>[] = [];
  const pageSize = options.status === "resolved" || options.status === "closed" ? 200 : 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = s.from("incidents").select("id,scope_kind,machine_id,odoo_warehouse_id,location_text,incident_type,source_kind,source_alert_id,source_alert_resolved_at,title,description,severity,status,owning_tenant_id,assigned_tenant_id,assigned_user_id,due_at,opened_at,resolved_at,resolution_summary,closure_kind,closing_action_report_id,machines(name,display_name,device_imei),odoo_warehouses(name),owning_tenant:tenants!incidents_owning_tenant_id_fkey(name),assigned_tenant:tenants!incidents_assigned_tenant_id_fkey(name),assigned_user:profiles!incidents_assigned_user_id_fkey(full_name,email),incident_type_policies(label)")
      .order(options.status === "resolved" || options.status === "closed" ? "resolved_at" : "opened_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (options.status === "open") query = query.in("status", incidentStatusesForView("active"));
    if (options.status === "resolved" || options.status === "closed") query = query.in("status", incidentStatusesForView("resolved"));
    if (options.machineIds) query = query.in("machine_id", options.machineIds);
    const accessFilter = incidentAccessFilter(session);
    if (accessFilter) query = query.or(accessFilter);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data as Record<string, unknown>[]) ?? []));
    if (!data || data.length < pageSize || options.status === "resolved" || options.status === "closed") break;
  }

  const ids = rows.map((row) => row.id as string);
  const eventsByIncident = new Map<string, IncidentEvent[]>();
  if (ids.length) {
    const { data, error } = await s.from("incident_events")
      .select("id,incident_id,event_type,from_status,to_status,message,created_at,profiles(full_name,email)")
      .in("incident_id", ids).order("created_at", { ascending: true });
    if (error) throw error;
    for (const raw of (data as Record<string, unknown>[]) ?? []) {
      const actor = relation(raw, "profiles");
      const event: IncidentEvent = {
        id: raw.id as string,
        type: raw.event_type as IncidentEvent["type"],
        actorName: actor ? String(actor.full_name || actor.email || "Unnamed user") : null,
        fromStatus: raw.from_status as string | null,
        toStatus: raw.to_status as string | null,
        message: raw.message as string | null,
        createdAt: raw.created_at as string,
      };
      const incidentId = raw.incident_id as string;
      eventsByIncident.set(incidentId, [...(eventsByIncident.get(incidentId) ?? []), event]);
    }
  }
  return rows.map((row) => presentIncident(row, eventsByIncident.get(row.id as string) ?? []));
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

export async function getIncidentWorkspaceOptions(session: SessionProfile): Promise<IncidentWorkspaceOptions> {
  if (!isSupabaseConfigured() || session.role === "operator") return { machines: [], warehouses: [], tenants: [], users: [] };
  const s = await createServiceClient();
  const allowedMachineIds = await accessibleMachineIds(s, session);
  let machineQuery = s.from("machines").select("id,name,display_name,odoo_warehouse_id").eq("deployed", true).order("name");
  if (allowedMachineIds) {
    machineQuery = allowedMachineIds.length ? machineQuery.in("id", allowedMachineIds) : machineQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  let userQuery = s.from("profiles").select("id,full_name,email,tenant_id,tenants(name)").order("full_name");
  if (session.role === "franchisee") userQuery = userQuery.eq("tenant_id", session.tenant_id!);
  const [machineResult, warehouseResult, tenantResult, userResult] = await Promise.all([
    machineQuery,
    s.from("odoo_warehouses").select("odoo_id,name").order("name"),
    session.role === "admin" ? s.from("tenants").select("id,name").eq("kind", "franchisee").order("name") : Promise.resolve({ data: [], error: null }),
    userQuery,
  ]);
  if (machineResult.error) throw machineResult.error;
  if (warehouseResult.error) throw warehouseResult.error;
  if (tenantResult.error) throw tenantResult.error;
  if (userResult.error) throw userResult.error;
  const machineRows = (machineResult.data as Record<string, unknown>[]) ?? [];
  const availableWarehouseIds = session.role === "franchisee"
    ? new Set(machineRows.map((row) => row.odoo_warehouse_id as number | null).filter((id): id is number => id !== null))
    : null;
  return {
    machines: machineRows.map((row) => ({ id: row.id as string, name: String(row.display_name || row.name) })),
    warehouses: ((warehouseResult.data as { odoo_id: number; name: string }[]) ?? [])
      .filter((row) => !availableWarehouseIds || availableWarehouseIds.has(row.odoo_id))
      .map((row) => ({ id: row.odoo_id, name: row.name })),
    tenants: (tenantResult.data as { id: string; name: string }[]) ?? [],
    users: ((userResult.data as Record<string, unknown>[]) ?? []).map((row) => {
      const tenant = relation(row, "tenants");
      return { id: row.id as string, name: String(row.full_name || row.email || "Unnamed user"), tenantId: row.tenant_id as string | null, tenantName: (tenant?.name as string) ?? null };
    }),
  };
}
