import { getOrders } from "@/lib/data/orders";
import { getAliasMap, resolveProductName } from "@/lib/data/products";
import { getDisplayTimezone } from "@/lib/timezone";
import { analyticsRange, filterAnalyticsOrders, ordersInPeriod, type AnalyticsParams } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function csv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: AnalyticsParams = {
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
    machine: url.searchParams.get("machine") ?? undefined,
    product: url.searchParams.get("product") ?? undefined,
    payType: url.searchParams.get("payType") ?? undefined,
  };
  const [timeZone, aliasMap] = await Promise.all([getDisplayTimezone(), getAliasMap()]);
  const range = analyticsRange(params, timeZone);
  const { orders, readError } = await getOrders({ dateFrom: range.from, dateTo: range.to, timeZone });
  if (readError) return new Response(`Supabase order read failed: ${readError}`, { status: 503 });
  const filtered = ordersInPeriod(filterAnalyticsOrders(orders, params, aliasMap), range.from, range.to, timeZone);
  const rows = filtered.map((order) => {
    const product = resolveProductName(order.product_name || order.products.map((item) => item.goodsName).filter(Boolean).join(" + "), aliasMap);
    const refunded = order.refund_status === "Refunded";
    return [order.order_time, order.machine_name, order.device_imei, order.order_code, product, order.pay_type, order.order_state, order.nums, order.price.toFixed(2), refunded ? order.price.toFixed(2) : "0.00", order.order_state === "COMPLETE" && !order.is_admin_override && !refunded ? order.price.toFixed(2) : "0.00"];
  });
  const output = [
    ["UTC time", "Machine", "IMEI", "Order code", "Product", "Payment method", "State", "Units", "Gross EUR", "Refunded EUR", "Net EUR"],
    ...rows,
  ].map((row) => row.map(csv).join(",")).join("\n");

  return new Response(`\uFEFF${output}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="softlife-analytics-${range.from}-${range.to}.csv"`,
    },
  });
}
