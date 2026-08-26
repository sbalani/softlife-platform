export type IncidentWorkflowStatus = "open" | "in_progress" | "resolved" | "closed";

type IncidentViewer = { id: string; role: "admin" | "operator" | "franchisee"; tenant_id: string | null };

export function incidentStatusesForView(view: "active" | "resolved"): IncidentWorkflowStatus[] {
  return view === "active" ? ["open", "in_progress"] : ["resolved", "closed"];
}

export function incidentAccessFilter(viewer: IncidentViewer): string | null {
  if (viewer.role === "admin") return null;
  if (viewer.role === "operator") return `assigned_user_id.eq.${viewer.id},created_by.eq.${viewer.id}`;
  if (!viewer.tenant_id) return "id.eq.00000000-0000-0000-0000-000000000000";
  return `owning_tenant_id.eq.${viewer.tenant_id},assigned_tenant_id.eq.${viewer.tenant_id},assigned_user_id.eq.${viewer.id},created_by.eq.${viewer.id}`;
}

export function canTransitionIncident(from: IncidentWorkflowStatus, to: IncidentWorkflowStatus): boolean {
  return (from === "open" && (to === "in_progress" || to === "resolved"))
    || (from === "in_progress" && to === "resolved")
    || ((from === "resolved" || from === "closed") && to === "open");
}
