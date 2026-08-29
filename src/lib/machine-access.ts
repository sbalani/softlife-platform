import { ymd } from "./dates.ts";
import type { Order } from "./data/orders.ts";

export type MachineAccessPeriod = { machine_id: string; start_date: string; end_date: string | null };

export function machinePeriodTenantScope(session: { role: string; tenant_id: string | null } | null): string | null | undefined {
  if (!session || session.role === "operator") return undefined;
  if (session.role === "admin") return null;
  return session.tenant_id ?? undefined;
}

export function filterOrdersByMachinePeriods(orders: Order[], periods: MachineAccessPeriod[] | null, timeZone: string): Order[] {
  if (periods === null) return orders;
  const byMachine = new Map<string, MachineAccessPeriod[]>();
  for (const period of periods) byMachine.set(period.machine_id, [...(byMachine.get(period.machine_id) ?? []), period]);
  return orders.filter((order) => {
    if (!order.machine_id) return false;
    const day = ymd(new Date(order.order_time), timeZone);
    return (byMachine.get(order.machine_id) ?? []).some((period) => period.start_date <= day && (!period.end_date || period.end_date >= day));
  });
}
