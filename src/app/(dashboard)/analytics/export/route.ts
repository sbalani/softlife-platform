import { getOrders } from "@/lib/data/orders";
import { getAliasMap, resolveProductName } from "@/lib/data/products";
import { getDisplayTimezone } from "@/lib/timezone";
import { analyticsRange, filterAnalyticsOrders, machineSalesReport, ordersInPeriod, type AnalyticsParams, type MachineSalesCadence } from "@/lib/analytics";
import { getAccessibleMachineIds, getAccessibleMachines } from "@/lib/data/accessible-machines";
import { createServiceClient } from "@/lib/supabase/server";
import { orderProductLabel } from "@/lib/order-products";

export const dynamic = "force-dynamic";

function csv(value: unknown): string {
  const raw = String(value ?? "");
  const text = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvResponse(rows: unknown[][], filename: string) {
  const output = rows.map((row) => row.map(csv).join(",")).join("\n");
  return new Response(`\uFEFF${output}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const report = url.searchParams.get("report");
  const params: AnalyticsParams = {
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
    machine: url.searchParams.get("machine") ?? undefined,
    product: url.searchParams.get("product") ?? undefined,
    payType: url.searchParams.get("payType") ?? undefined,
  };
  const [timeZone, aliasMap, machineScope] = await Promise.all([getDisplayTimezone(), getAliasMap(), getAccessibleMachineIds()]);
  const range = analyticsRange(params, timeZone);
  const scopedClient = machineScope === null ? undefined : await createServiceClient();
  const orderResult = machineScope?.length === 0 ? { orders: [], readError: undefined } : await getOrders({ dateFrom: range.from, dateTo: range.to, timeZone }, scopedClient);
  const allowedImeis = machineScope === null ? null : new Set((await getAccessibleMachines()).map((machine) => machine.device_imei));
  const orders = allowedImeis ? orderResult.orders.filter((order) => !!order.device_imei && allowedImeis.has(order.device_imei)) : orderResult.orders;
  const { readError } = orderResult;
  if (readError) return new Response(`Supabase order read failed: ${readError}`, { status: 503 });
  const filtered = ordersInPeriod(filterAnalyticsOrders(orders, params, aliasMap), range.from, range.to, timeZone);
  if (report === "weekly" || report === "monthly") {
    const cadence = report as MachineSalesCadence;
    const rows = machineSalesReport(filtered, cadence, timeZone, range.from, range.to).map((row) => [
      row.period, row.periodStart, row.periodEnd, row.dataFrom, row.dataTo, row.partial ? "Yes" : "No", row.machine, row.imei, row.orders, row.units,
      row.gross.toFixed(2), row.refundedOrders, row.refunded.toFixed(2), row.net.toFixed(2),
      (row.orders ? row.net / row.orders : 0).toFixed(2),
    ]);
    return csvResponse([
      ["Period", "Period start", "Period end", "Sales included from", "Sales included to", "Partial period", "Machine", "IMEI", "Net orders", "Net units", "Gross EUR", "Refunded orders", "Refunded EUR", "Net sales EUR", "Average order EUR"],
      ...rows,
    ], `softlife-${cadence}-machine-sales-${range.from}-${range.to}.csv`);
  }
  const rows = filtered.map((order) => {
    const product = orderProductLabel(order, (rawName) => resolveProductName(rawName, aliasMap));
    const refunded = order.refund_status === "Refunded";
    return [order.order_time, order.machine_name, order.device_imei, order.order_code, product, order.pay_type, order.order_state, order.nums, order.price.toFixed(2), refunded ? order.price.toFixed(2) : "0.00", order.order_state === "COMPLETE" && !order.is_admin_override && !refunded ? order.price.toFixed(2) : "0.00"];
  });
  return csvResponse([
    ["UTC time", "Machine", "IMEI", "Order code", "Products", "Payment method", "State", "Units", "Gross EUR", "Refunded EUR", "Net EUR"],
    ...rows,
  ], `softlife-analytics-${range.from}-${range.to}.csv`);
}
