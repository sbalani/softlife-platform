import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TZ, ymd } from "@/lib/dates";
import { getMachines } from "@/lib/data/machines";
import { presentMachineStatuses, type MachineStatusSnapshot } from "@/lib/data/mobile-machine-status";
import { getOrders } from "@/lib/data/orders";

const orderFilters = (machineIds: string[] | null) => machineIds === null ? {} : { machineIds };

export function mobileAnalyticsRange(req: Request) {
  const params = new URL(req.url).searchParams;
  const requestedDate = params.get("date");
  const today = ymd(new Date(), DEFAULT_TZ);
  const dateFrom = params.get("from") ?? requestedDate ?? today;
  const dateTo = params.get("to") ?? requestedDate ?? dateFrom;
  const validDate = (value: string) => {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(timestamp)
      && new Date(timestamp).toISOString().slice(0, 10) === value;
  };
  const rangeDays = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000;
  return { dateFrom, dateTo, valid: validDate(dateFrom) && validDate(dateTo) && Number.isFinite(rangeDays) && rangeDays >= 0 && rangeDays <= 89 };
}

export async function mobileFleet(machineIds: string[] | null, service: SupabaseClient) {
  const date = ymd(new Date(), DEFAULT_TZ);
  const [{ machines, readError }, orderResult] = await Promise.all([
    getMachines(machineIds ?? undefined),
    getOrders({ dateFrom: date, dateTo: date, timeZone: DEFAULT_TZ, ...orderFilters(machineIds) }, service),
  ]);
  if (readError) throw new Error(readError);
  if (orderResult.readError) throw new Error(orderResult.readError);
  const sales = new Map<string, { amount: number; orders: number; units: number }>();
  for (const order of orderResult.orders) {
    if (!order.machine_id || order.order_state !== "COMPLETE" || order.is_admin_override || order.refund_status === "Refunded") continue;
    const row = sales.get(order.machine_id) ?? { amount: 0, orders: 0, units: 0 };
    row.amount += order.price;
    row.orders++;
    row.units += order.nums;
    sales.set(order.machine_id, row);
  }
  return {
    date,
    time_zone: DEFAULT_TZ,
    order_sync: orderResult.sync,
    sales_stale: machineIds?.length === 0 ? false : !orderResult.sync || orderResult.sync.status !== "succeeded" || orderResult.sync.failedMachines > 0,
    machines: machines.map((machine) => {
      const today = sales.get(machine.id) ?? { amount: 0, orders: 0, units: 0 };
      return {
        id: machine.id,
        name: machine.display_name || machine.name,
        imei: machine.device_imei,
        location: machine.location,
        online: machine.net_online,
        oos: machine.oos,
        active_alert_count: machine.active_alert_count,
        status_observed_at: machine.status_observed_at,
        status_stale: !machine.status_observed_at || Date.now() - Date.parse(machine.status_observed_at) > 2 * 60 * 60 * 1000,
        sales_today: Number(today.amount.toFixed(2)),
        orders_today: today.orders,
        units_today: today.units,
      };
    }),
  };
}

export async function mobileMachineAnalytics(id: string, service: SupabaseClient) {
  const date = ymd(new Date(), DEFAULT_TZ);
  const [{ machines, readError }, statusResult, orderResult] = await Promise.all([
    getMachines([id]),
    service.from("machine_status_snapshots").select("field,raw,observed_at").eq("machine_id", id).like("field", "raw:%"),
    getOrders({ dateFrom: date, dateTo: date, timeZone: DEFAULT_TZ, machineIds: [id] }, service),
  ]);
  if (readError) throw new Error(readError);
  if (statusResult.error) throw statusResult.error;
  if (orderResult.readError) throw new Error(orderResult.readError);
  const machine = machines[0];
  if (!machine) return null;
  const { statuses } = presentMachineStatuses((statusResult.data as MachineStatusSnapshot[]) ?? []);
  const sales = orderResult.orders.filter((order) => order.order_state === "COMPLETE" && !order.is_admin_override && order.refund_status !== "Refunded");
  return {
    date,
    time_zone: DEFAULT_TZ,
    order_sync: orderResult.sync,
    sales_stale: !orderResult.sync || orderResult.sync.status !== "succeeded" || orderResult.sync.failedMachines > 0,
    machine: {
      id: machine.id,
      name: machine.display_name || machine.name,
      imei: machine.device_imei,
      location: machine.location,
      online: machine.net_online,
      oos: machine.oos,
      active_alert_count: machine.active_alert_count,
      status_observed_at: machine.status_observed_at,
      status_stale: !machine.status_observed_at || Date.now() - Date.parse(machine.status_observed_at) > 2 * 60 * 60 * 1000,
      sales_today: Number(sales.reduce((sum, order) => sum + order.price, 0).toFixed(2)),
      orders_today: sales.length,
      units_today: sales.reduce((sum, order) => sum + order.nums, 0),
    },
    statuses,
    orders: orderResult.orders.slice(0, 50).map((order) => ({ id: order.id, order_time: order.order_time, order_code: order.order_code, product_name: order.product_name, products: order.products, state: order.order_state, price: order.price, units: order.nums, refunded: order.refund_status === "Refunded", admin_override: order.is_admin_override })),
  };
}

export async function mobileOrders(machineIds: string[] | null, dateFrom: string, dateTo: string, service: SupabaseClient) {
  const result = await getOrders({ dateFrom, dateTo, timeZone: DEFAULT_TZ, ...orderFilters(machineIds) }, service);
  if (result.readError) throw new Error(result.readError);
  return {
    date: dateFrom === dateTo ? dateFrom : `${dateFrom}/${dateTo}`,
    date_from: dateFrom,
    date_to: dateTo,
    time_zone: DEFAULT_TZ,
    sync: result.sync,
    orders: result.orders.map((order) => ({
      id: order.id,
      order_time: order.order_time,
      order_code: order.order_code,
      machine_name: order.machine_name,
      device_imei: order.device_imei,
      product_name: order.product_name,
      products: order.products,
      state: order.order_state,
      price: order.price,
      units: order.nums,
      pay_type: order.pay_type,
      refunded: order.refund_status === "Refunded",
      admin_override: order.is_admin_override,
    })),
  };
}
