import Link from "next/link";
import { getOrders, type Order } from "@/lib/data/orders";
import { getMachines } from "@/lib/data/machines";
import { LineChart } from "@/components/LineChart";
import { HBarChart, KpiCard, VBarChart } from "@/components/charts";
import { ymd } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getAliasMap, resolveProductName } from "@/lib/data/products";
import { getSessionProfile } from "@/lib/auth/session";
import { calculateFranchiseePayouts } from "@/lib/data/franchisee-profit";
import { analyticsRange, datesBetween, filterAnalyticsOrders, ordersInPeriod, type AnalyticsParams } from "@/lib/analytics";
import { OrderDataNote } from "@/components/order-data-note";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function percentChange(current: number, previous: number): string {
  if (!previous) return current ? "New vs previous period" : "No change vs previous period";
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs previous period`;
}

function netSales(orders: Order[]): Order[] {
  return orders.filter((order) => order.order_state === "COMPLETE" && !order.is_admin_override && order.refund_status !== "Refunded");
}

function completedSales(orders: Order[]): Order[] {
  return orders.filter((order) => order.order_state === "COMPLETE" && !order.is_admin_override);
}

function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return {
    weekday: parts.find((part) => part.type === "weekday")?.value ?? "Mon",
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
  };
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<AnalyticsParams> }) {
  const [params, tz, { machines }, aliasMap, session] = await Promise.all([
    searchParams,
    getDisplayTimezone(),
    getMachines(),
    getAliasMap(),
    getSessionProfile(),
  ]);
  const range = analyticsRange(params, tz);
  const { orders: loadedOrders, sync, readError } = await getOrders({
    dateFrom: range.previousFrom,
    dateTo: range.to,
    timeZone: tz,
  });
  const filtered = filterAnalyticsOrders(loadedOrders, params, aliasMap);
  const currentOrders = ordersInPeriod(filtered, range.from, range.to, tz);
  const previousOrders = ordersInPeriod(filtered, range.previousFrom, range.previousTo, tz);
  const eligibleOrders = currentOrders.filter((order) => !order.is_admin_override);
  const completed = completedSales(currentOrders);
  const sales = netSales(currentOrders);
  const previousSales = netSales(previousOrders);
  const revenue = sales.reduce((sum, order) => sum + order.price, 0);
  const previousRevenue = previousSales.reduce((sum, order) => sum + order.price, 0);
  const units = sales.reduce((sum, order) => sum + order.nums, 0);
  const previousUnits = previousSales.reduce((sum, order) => sum + order.nums, 0);
  const averageOrder = sales.length ? revenue / sales.length : 0;
  const previousAverage = previousSales.length ? previousRevenue / previousSales.length : 0;
  const refunded = completed.filter((order) => order.refund_status === "Refunded");
  const refundedValue = refunded.reduce((sum, order) => sum + order.price, 0);
  const payoutRows = session?.role === "admin" ? await calculateFranchiseePayouts(sales) : [];
  const payoutGroups = [...new Set(payoutRows.map((row) => row.tenantId))].map((tenantId) => {
    const rows = payoutRows.filter((row) => row.tenantId === tenantId);
    return { tenantId, tenantName: rows[0]?.tenantName ?? "Franchisee", rows, payout: rows.reduce((sum, row) => sum + row.payout, 0) };
  });

  const days = datesBetween(range.from, range.days);
  const revenueByDay = new Map<string, number>();
  for (const order of sales) {
    const day = ymd(new Date(order.order_time), tz);
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + order.price);
  }
  const revenueTrend = days.map((day) => ({
    label: new Date(`${day}T12:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" }),
    value: Number((revenueByDay.get(day) ?? 0).toFixed(2)),
  }));

  const weekdayOccurrences = new Array(7).fill(0);
  for (const day of days) weekdayOccurrences[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]++;
  const weekdayRevenue = new Array(7).fill(0);
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const order of sales) {
    const local = localParts(order.order_time, tz);
    const weekday = WEEKDAYS.indexOf(local.weekday);
    if (weekday < 0) continue;
    weekdayRevenue[weekday] += order.price;
    heatmap[weekday][local.hour] += order.price;
  }
  const weekdayData = WEEKDAYS.map((label, index) => ({ label, value: Number((weekdayRevenue[index] / Math.max(weekdayOccurrences[index], 1)).toFixed(2)) }));
  const heatMax = Math.max(...heatmap.flat(), 1);

  const machineStats = new Map<string, { name: string; imei: string; revenue: number; units: number; orders: number; refunds: number }>();
  for (const order of completed) {
    const key = order.device_imei ?? order.machine_name ?? "Unknown";
    const row = machineStats.get(key) ?? { name: order.machine_name ?? "Unknown", imei: order.device_imei ?? "", revenue: 0, units: 0, orders: 0, refunds: 0 };
    if (order.refund_status === "Refunded") row.refunds++;
    else { row.revenue += order.price; row.units += order.nums; row.orders++; }
    machineStats.set(key, row);
  }
  const machineRows = [...machineStats.values()].sort((a, b) => b.revenue - a.revenue);
  const machineBars = machineRows.slice(0, 8).map((row) => ({ label: row.name, value: Number(row.revenue.toFixed(2)), href: row.imei ? `/machines/${row.imei}` : undefined }));

  const productStats = new Map<string, { revenue: number; units: number; orders: number }>();
  for (const order of sales) {
    const rawName = order.product_name || order.products.map((item) => item.goodsName).filter(Boolean).join(" + ") || "Unknown";
    const name = resolveProductName(rawName, aliasMap);
    const row = productStats.get(name) ?? { revenue: 0, units: 0, orders: 0 };
    row.revenue += order.price;
    row.units += order.nums;
    row.orders++;
    productStats.set(name, row);
  }
  const productRows = [...productStats.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.revenue - a.revenue);
  const productBars = productRows.slice(0, 10).map((row) => ({ label: row.name, value: row.units }));

  const paymentStats = new Map<string, { revenue: number; orders: number }>();
  for (const order of sales) {
    const name = order.pay_type ?? "Unknown";
    const row = paymentStats.get(name) ?? { revenue: 0, orders: 0 };
    row.revenue += order.price;
    row.orders++;
    paymentStats.set(name, row);
  }
  const paymentRows = [...paymentStats.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.revenue - a.revenue);
  const paymentOptions = [...new Set(loadedOrders.map((order) => order.pay_type).filter((value): value is string => !!value))].sort();
  const query = new URLSearchParams(Object.entries({ dateFrom: range.from, dateTo: range.to, machine: params.machine, product: params.product, payType: params.payType }).filter((entry): entry is [string, string] => !!entry[1]));
  const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
  const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="font-display text-3xl font-bold text-cocoa">Analytics</h1><p className="mt-1 text-sm text-taupe">{range.from} to {range.to} · {tz} · Refunded and admin-test orders excluded from net sales</p></div>
        <Link href={`/analytics/export?${query}`} className="rounded-lg border border-terracotta px-4 py-2 text-sm font-bold text-terracotta hover:bg-terracotta/5">Export CSV</Link>
      </header>

      <form className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4">
        <label><span className={label}>From</span><input type="date" name="dateFrom" defaultValue={range.from} max={range.to} className={input} /></label>
        <label><span className={label}>To</span><input type="date" name="dateTo" defaultValue={range.to} min={range.from} max={range.today} className={input} /></label>
        <label><span className={label}>Machine</span><select name="machine" defaultValue={params.machine ?? ""} className={input}><option value="">All machines</option>{machines.filter((machine) => machine.device_imei).map((machine) => <option key={machine.id} value={machine.device_imei!}>{machine.name}</option>)}</select></label>
        <label><span className={label}>Product</span><input name="product" defaultValue={params.product} placeholder="Name or alias" className={`w-40 ${input}`} /></label>
        <label><span className={label}>Payment</span><select name="payType" defaultValue={params.payType ?? ""} className={input}><option value="">All methods</option>{paymentOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <button className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Apply</button>
        <Link href="/analytics" className="text-sm font-semibold text-terracotta">Clear</Link>
      </form>

      <div className="mb-5"><OrderDataNote sync={sync} readError={readError} requestedTo={range.to} timeZone={tz} /></div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Net sales" value={`€${revenue.toFixed(2)}`} hint={percentChange(revenue, previousRevenue)} accent="#d47e54" />
        <KpiCard label="Completed orders" value={`${sales.length}`} hint={percentChange(sales.length, previousSales.length)} accent="#6fa98c" />
        <KpiCard label="Units sold" value={`${units}`} hint={percentChange(units, previousUnits)} accent="#d47e54" />
        <KpiCard label="Average order" value={`€${averageOrder.toFixed(2)}`} hint={percentChange(averageOrder, previousAverage)} accent="#6fa98c" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Refunded value" value={`€${refundedValue.toFixed(2)}`} hint={`${refunded.length} refunded order(s)`} accent="#b65d5d" />
        <KpiCard label="Completion rate" value={`${eligibleOrders.length ? ((completed.length / eligibleOrders.length) * 100).toFixed(1) : "0.0"}%`} hint={`${completed.length} of ${eligibleOrders.length} non-test orders`} accent="#6fa98c" />
        <KpiCard label="Selling machines" value={`${machineRows.length}`} hint={`${machines.filter((machine) => machine.net_online).length} online now`} accent="#d47e54" />
        <KpiCard label="Franchisee payout" value={`€${payoutRows.reduce((sum, row) => sum + row.payout, 0).toFixed(2)}`} hint="VAT removed before share" accent="#6fa98c" />
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5"><h2 className="font-display text-lg font-bold text-cocoa">Net sales trend</h2><p className="mb-2 text-xs text-taupe">Daily, refund-adjusted revenue</p><div className="overflow-x-auto"><div style={{ minWidth: Math.max(600, revenueTrend.length * 32) }}><LineChart data={revenueTrend} color="#d47e54" height={220} unit="€" /></div></div></section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-1 font-display text-lg font-bold text-cocoa">Average sales by weekday</h2><p className="mb-3 text-xs text-taupe">Average per occurrence, avoiding unequal-weekday bias</p><VBarChart data={weekdayData} color="#d47e54" formatValue={(value) => `€${value.toFixed(0)}`} /></section>
        <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-1 font-display text-lg font-bold text-cocoa">Top products</h2><p className="mb-3 text-xs text-taupe">Units sold after alias resolution</p><HBarChart data={productBars} color="#6fa98c" unit="×" /></section>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Sales heatmap</h2><p className="mb-4 text-xs text-taupe">Revenue by local weekday and hour · {tz}</p>
        <div className="overflow-x-auto"><div className="min-w-[820px]"><div className="grid grid-cols-[44px_repeat(24,minmax(24px,1fr))] gap-1 text-center text-[9px] text-taupe"><span />{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour}</span>)}{heatmap.flatMap((row, weekday) => [<span key={`${weekday}-label`} className="self-center text-left font-bold">{WEEKDAYS[weekday]}</span>, ...row.map((value, hour) => <span key={`${weekday}-${hour}`} title={`${WEEKDAYS[weekday]} ${hour}:00 · €${value.toFixed(2)}`} className="h-7 rounded border border-line/40" style={{ backgroundColor: `rgba(212,126,84,${value ? 0.15 + (value / heatMax) * 0.85 : 0.03})` }} />)])}</div></div></div>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Machine performance</h2><p className="mb-3 text-xs text-taupe">Grouped by IMEI, not mutable machine name</p>
        {machineBars.length > 0 && <div className="mb-5"><VBarChart data={machineBars} color="#d47e54" formatValue={(value) => `€${value.toFixed(0)}`} /></div>}
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-left text-[11px] uppercase text-taupe"><tr><th className="py-2">Machine</th><th>IMEI</th><th className="text-right">Orders</th><th className="text-right">Units</th><th className="text-right">AOV</th><th className="text-right">Refunds</th><th className="text-right">Net sales</th></tr></thead><tbody className="divide-y divide-line">{machineRows.map((row) => <tr key={row.imei || row.name}><td className="py-2 font-semibold text-cocoa">{row.imei ? <Link href={`/machines/${row.imei}`} className="text-terracotta">{row.name}</Link> : row.name}</td><td className="font-mono text-xs text-taupe">{row.imei || "—"}</td><td className="text-right">{row.orders}</td><td className="text-right">{row.units}</td><td className="text-right">€{(row.orders ? row.revenue / row.orders : 0).toFixed(2)}</td><td className="text-right">{row.refunds}</td><td className="text-right font-bold">€{row.revenue.toFixed(2)}</td></tr>)}</tbody></table>{!machineRows.length && <p className="py-8 text-center text-sm text-taupe">No machine sales match these filters.</p>}</div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-3 font-display text-lg font-bold text-cocoa">Product performance</h2><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="text-left text-[11px] uppercase text-taupe"><tr><th className="py-2">Product</th><th className="text-right">Orders</th><th className="text-right">Units</th><th className="text-right">Net sales</th></tr></thead><tbody className="divide-y divide-line">{productRows.map((row) => <tr key={row.name}><td className="py-2 font-semibold text-cocoa">{row.name}</td><td className="text-right">{row.orders}</td><td className="text-right">{row.units}</td><td className="text-right font-bold">€{row.revenue.toFixed(2)}</td></tr>)}</tbody></table></div></section>
        <section className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-3 font-display text-lg font-bold text-cocoa">Payment methods</h2><div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead className="text-left text-[11px] uppercase text-taupe"><tr><th className="py-2">Method</th><th className="text-right">Orders</th><th className="text-right">Net sales</th></tr></thead><tbody className="divide-y divide-line">{paymentRows.map((row) => <tr key={row.name}><td className="py-2 font-semibold text-cocoa">{row.name}</td><td className="text-right">{row.orders}</td><td className="text-right font-bold">€{row.revenue.toFixed(2)}</td></tr>)}</tbody></table></div></section>
      </div>

      {session?.role === "admin" && payoutGroups.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Franchisee profit share</h2>
          <p className="mb-4 text-xs text-taupe">Filtered period · VAT removed before assignment share</p>
          <div className="space-y-4">
            {payoutGroups.map((group) => (
              <div key={group.tenantId} className="rounded-xl border border-line p-4">
                <div className="mb-3 flex justify-between gap-3"><span className="font-bold text-cocoa">{group.tenantName}</span><span className="font-bold text-sage">€{group.payout.toFixed(2)}</span></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-xs"><thead className="text-left uppercase text-taupe"><tr><th className="py-2">Machine</th><th>Period</th><th className="text-right">Share</th><th className="text-right">Orders</th><th className="text-right">Gross</th><th className="text-right">VAT</th><th className="text-right">Net</th><th className="text-right">Payout</th></tr></thead><tbody className="divide-y divide-line">{group.rows.map((row) => <tr key={row.assignmentId}><td className="py-2 font-semibold text-cocoa">{row.machineName}</td><td>{row.period}</td><td className="text-right">{row.sharePercent}%</td><td className="text-right">{row.orders}</td><td className="text-right">€{row.gross.toFixed(2)}</td><td className="text-right">€{row.vat.toFixed(2)}</td><td className="text-right">€{row.net.toFixed(2)}</td><td className="text-right font-bold text-sage">€{row.payout.toFixed(2)}</td></tr>)}</tbody></table></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
