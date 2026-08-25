import type { Order } from "./data/orders.ts";
import type { AliasMap } from "./data/products.ts";
import { ymd } from "./dates.ts";

export type AnalyticsParams = {
  dateFrom?: string;
  dateTo?: string;
  machineId?: string;
  /** Legacy bookmarked filter; new links use stable machineId. */
  machine?: string;
  product?: string;
  payType?: string;
};

export function shiftDay(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type AnalyticsPeriodPreset = "last-month" | "this-month" | "this-week" | "last-week" | "yesterday" | "today";

export function analyticsPresetRange(preset: AnalyticsPeriodPreset, timeZone: string, now = new Date()): { from: string; to: string } {
  const today = ymd(now, timeZone);
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const yesterday = shiftDay(today, -1);
    return { from: yesterday, to: yesterday };
  }
  const mondayOffset = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const thisMonday = shiftDay(today, -mondayOffset);
  if (preset === "this-week") return { from: thisMonday, to: today };
  if (preset === "last-week") return { from: shiftDay(thisMonday, -7), to: shiftDay(thisMonday, -1) };
  const thisMonth = `${today.slice(0, 7)}-01`;
  if (preset === "this-month") return { from: thisMonth, to: today };
  const previousMonthEnd = shiftDay(thisMonth, -1);
  return { from: `${previousMonthEnd.slice(0, 7)}-01`, to: previousMonthEnd };
}

function validDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function analyticsRange(params: AnalyticsParams, timeZone: string) {
  const today = ymd(new Date(), timeZone);
  const to = validDate(params.dateTo) && params.dateTo <= today ? params.dateTo : today;
  let from = validDate(params.dateFrom) ? params.dateFrom : shiftDay(to, -29);
  if (from > to) from = shiftDay(to, -29);
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 365 * 86_400_000) from = shiftDay(to, -365);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const previousTo = shiftDay(from, -1);
  const previousFrom = shiftDay(previousTo, -(days - 1));
  return { from, to, days, previousFrom, previousTo, today };
}

export function datesBetween(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => shiftDay(from, i));
}

export function filterAnalyticsOrders(orders: Order[], params: AnalyticsParams, aliasMap: AliasMap): Order[] {
  const product = params.product?.trim().toLowerCase();
  return orders.filter((order) => {
    if (params.machineId && order.machine_id !== params.machineId) return false;
    if (!params.machineId && params.machine && order.device_imei !== params.machine) return false;
    if (params.payType && order.pay_type !== params.payType) return false;
    if (!product) return true;
    const names = order.products.length ? order.products.map((item) => item.goodsName) : [order.product_name];
    return names.some((name) => {
      const raw = name ?? "";
      const canonical = aliasMap.get(raw.toLowerCase().trim())?.productName ?? raw;
      return canonical.toLowerCase().includes(product);
    });
  });
}

export type ToppingConsumptionRow = { name: string; servings: number; orders: number };

export function toppingConsumption(orders: Order[], aliasMap: AliasMap): ToppingConsumptionRow[] {
  const rows = new Map<string, ToppingConsumptionRow>();
  for (const order of orders) {
    if (order.order_state !== "COMPLETE" || order.is_admin_override || order.refund_status === "Refunded") continue;
    const orderNames = new Set<string>();
    for (const product of order.products) {
      const rawName = product.goodsName?.trim();
      if (!rawName) continue;
      const resolved = aliasMap.get(rawName.toLowerCase());
      const hasKnownPosition = Number.isFinite(product.position);
      const isSolidToppingPosition = hasKnownPosition && product.position >= 2 && product.position <= 4;
      if (hasKnownPosition && !isSolidToppingPosition) continue;
      if (resolved?.productType && resolved.productType !== "topping") continue;
      if (!hasKnownPosition && !resolved?.productType) continue;
      const name = resolved?.productName ?? rawName;
      const row = rows.get(name) ?? { name, servings: 0, orders: 0 };
      row.servings += Math.max(order.nums, 0);
      if (!orderNames.has(name)) {
        row.orders++;
        orderNames.add(name);
      }
      rows.set(name, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.servings - a.servings || a.name.localeCompare(b.name));
}

export function canonicalProductCombination(order: Pick<Order, "products" | "product_name">, aliasMap: AliasMap): string {
  const names = (order.products.length ? order.products.map((product) => product.goodsName) : [order.product_name])
    .filter((name): name is string => typeof name === "string" && Boolean(name.trim()));
  return names.map((name) => aliasMap.get(name.toLowerCase().trim())?.productName ?? name.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)).join(" + ");
}

export function ordersInPeriod(orders: Order[], from: string, to: string, timeZone: string): Order[] {
  return orders.filter((order) => {
    const day = ymd(new Date(order.order_time), timeZone);
    return day >= from && day <= to;
  });
}

export type MachineSalesCadence = "weekly" | "monthly";

export type MachineSalesRow = {
  period: string;
  periodStart: string;
  periodEnd: string;
  dataFrom: string;
  dataTo: string;
  partial: boolean;
  machine: string;
  machineId: string;
  imei: string;
  orders: number;
  units: number;
  gross: number;
  refundedOrders: number;
  refunded: number;
  net: number;
};

function salesPeriod(day: string, cadence: MachineSalesCadence) {
  if (cadence === "monthly") {
    const [year, month] = day.split("-").map(Number);
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { period: day.slice(0, 7), start: `${day.slice(0, 7)}-01`, end };
  }
  const mondayOffset = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = shiftDay(day, -mondayOffset);
  const end = shiftDay(start, 6);
  return { period: `${start} to ${end}`, start, end };
}

export function machineSalesReport(orders: Order[], cadence: MachineSalesCadence, timeZone: string, from?: string, to?: string): MachineSalesRow[] {
  const rows = new Map<string, MachineSalesRow>();
  for (const order of orders) {
    if (order.order_state !== "COMPLETE" || order.is_admin_override) continue;
    const bucket = salesPeriod(ymd(new Date(order.order_time), timeZone), cadence);
    const machineId = order.machine_id ?? "";
    const imei = order.device_imei ?? "";
    const machine = order.machine_name ?? "Unknown";
    const key = `${bucket.start}\0${machineId ? `id:${machineId}` : imei ? `imei:${imei}` : `name:${machine}`}`;
    const dataFrom = from && from > bucket.start ? from : bucket.start;
    const dataTo = to && to < bucket.end ? to : bucket.end;
    const row = rows.get(key) ?? {
      period: bucket.period, periodStart: bucket.start, periodEnd: bucket.end,
      dataFrom, dataTo, partial: dataFrom !== bucket.start || dataTo !== bucket.end,
      machine, machineId, imei, orders: 0, units: 0, gross: 0, refundedOrders: 0, refunded: 0, net: 0,
    };
    row.gross += order.price;
    if (order.refund_status === "Refunded") {
      row.refundedOrders++;
      row.refunded += order.price;
    } else {
      row.orders++;
      row.units += order.nums;
      row.net += order.price;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.machine.localeCompare(b.machine));
}
