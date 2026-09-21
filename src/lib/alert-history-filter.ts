export type AlertCustomerOption = { id: string; name: string };

export function resolveAlertHistoryCustomer(
  actor: { role: string; tenant_id: string | null } | null,
  requestedTenant: string | null,
  options: AlertCustomerOption[],
): string | null {
  if (actor?.role === "franchisee") return actor.tenant_id;
  if (actor?.role !== "admin" || !requestedTenant) return null;
  return options.some((tenant) => tenant.id === requestedTenant) ? requestedTenant : null;
}
