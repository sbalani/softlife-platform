import { getOrders } from "@/lib/data/orders";
import { getMachines } from "@/lib/data/machines";
import { LineChart } from "@/components/LineChart";
import { HBarChart, KpiCard, VBarChart } from "@/components/charts";
import { ymd } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getAliasMap, resolveProductName } from "@/lib/data/products";
import { getSessionProfile } from "@/lib/auth/session";
import { calculateFranchiseePayouts } from "@/lib/data/franchisee-profit";

export const dynamic = "force-dynamic";

function dayKey(iso: string, tz: string): string {
  return ymd(new Date(iso.replace(" ", "T")), tz);
}

export default async function AnalyticsPage() {
  const [{ orders, source }, { machines }, tz, aliasMap, session] = await Promise.all([
    getOrders(),
    getMachines(),
    getDisplayTimezone(),
    getAliasMap(),
    getSessionProfile(),
  ]);
  const completed = orders.filter((o) => o.order_state === "COMPLETE" && !o.is_admin_override);
  const totalRevenue = completed.reduce((s, o) => s + o.price, 0);
  const totalUnits = completed.reduce((s, o) => s + o.nums, 0);
  const avgOrderValue = completed.length ? totalRevenue / completed.length : 0;
  const payoutRows = session?.role === "admin" ? await calculateFranchiseePayouts(completed) : [];
  const payoutGroups = [...new Set(payoutRows.map((row) => row.tenantId))].map((tenantId) => {
    const rows = payoutRows.filter((row) => row.tenantId === tenantId);
    return { tenantId, tenantName: rows[0]?.tenantName ?? "Franchisee", rows, payout: rows.reduce((sum, row) => sum + row.payout, 0) };
  });

  // Revenue per day (all available days)
  const revenueByDay = new Map<string, number>();
  const unitsByDay = new Map<string, number>();
  for (const o of completed) {
    const key = dayKey(o.order_time, tz);
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + o.price);
    unitsByDay.set(key, (unitsByDay.get(key) ?? 0) + o.nums);
  }
  const sortedDays = [...revenueByDay.keys()].sort();
  const revenueTrend = sortedDays.map((d) => ({ label: new Date(d).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: tz }), value: Number((revenueByDay.get(d) ?? 0).toFixed(2)) }));
  const unitsTrend = sortedDays.map((d) => ({ label: new Date(d).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: tz }), value: unitsByDay.get(d) ?? 0 }));

  // Revenue by weekday (Monday=0 ... Sunday=6)
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekdayRevenue = [0, 0, 0, 0, 0, 0, 0];
  const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
  for (const o of completed) {
    const d = new Date(o.order_time.replace(" ", "T"));
    const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    const dow = (local.getDay() + 6) % 7;
    weekdayRevenue[dow] += o.price;
    weekdayCount[dow]++;
  }
  const weekdayData = weekdayNames.map((label, i) => ({ label, value: Number(weekdayRevenue[i].toFixed(2)) }));

  // Revenue by hour
  const hourlyRevenue = new Array(24).fill(0);
  const hourlyCount = new Array(24).fill(0);
  for (const o of completed) {
    const d = new Date(o.order_time.replace(" ", "T"));
    const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    const h = local.getHours();
    hourlyRevenue[h] += o.price;
    hourlyCount[h]++;
  }
  const hourData = hourlyRevenue
    .map((val, h) => ({ label: `${h}:00`, value: Number(val.toFixed(2)) }))
    .filter((d) => d.value > 0);

  // Machine breakdown
  const machineStats = new Map<string, { revenue: number; units: number; orders: number }>();
  for (const o of completed) {
    const name = o.machine_name ?? o.device_imei ?? "Unknown";
    const prev = machineStats.get(name) ?? { revenue: 0, units: 0, orders: 0 };
    machineStats.set(name, { revenue: prev.revenue + o.price, units: prev.units + o.nums, orders: prev.orders + 1 });
  }
  const machineBars = [...machineStats.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 8)
    .map(([label, v]) => {
      const m = machines.find((x) => x.name === label);
      return { label, value: Number(v.revenue.toFixed(2)), href: m?.device_imei ? `/machines/${m.device_imei}` : undefined };
    });

  // Topping consumption
  const productCounts = new Map<string, number>();
  for (const o of completed) {
    const names = o.products.length ? o.products.map((p) => p.goodsName ?? "") : [o.product_name];
    for (const n of names) {
      if (!n) continue;
      const resolved = resolveProductName(n, aliasMap);
      productCounts.set(resolved, (productCounts.get(resolved) ?? 0) + 1);
    }
  }
  const topToppings = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }));

  // Payment type breakdown
  const payTypeCounts = new Map<string, number>();
  const payTypeRevenue = new Map<string, number>();
  for (const o of completed) {
    const pt = o.pay_type ?? "Unknown";
    payTypeCounts.set(pt, (payTypeCounts.get(pt) ?? 0) + 1);
    payTypeRevenue.set(pt, (payTypeRevenue.get(pt) ?? 0) + o.price);
  }
  const payTypeData = [...payTypeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Analytics</h1>
        <p className="mt-1 text-sm text-taupe">{completed.length} completed orders · €{totalRevenue.toFixed(2)} revenue · {totalUnits} units</p>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total revenue" value={`€${totalRevenue.toFixed(2)}`} hint={`${completed.length} orders`} accent="#d47e54" />
        <KpiCard label="Avg order value" value={`€${avgOrderValue.toFixed(2)}`} hint="per completed order" accent="#6fa98c" />
        <KpiCard label="Units sold" value={`${totalUnits}`} hint="total dispenses" accent="#d47e54" />
        <KpiCard label="Machines active" value={`${machines.filter((m) => m.net_online).length}`} hint={`of ${machines.length} total`} accent="#6fa98c" />
      </div>

      {session?.role === "admin" && (
        <section className="mt-6 rounded-2xl border border-line bg-white p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-cocoa">Franchisee profit share</h2>
              <p className="text-xs text-taupe">Internal payout estimate. VAT is removed first, then the assignment share is applied.</p>
            </div>
            <div className="font-display text-2xl font-bold text-terracotta">€{payoutGroups.reduce((sum, group) => sum + group.payout, 0).toFixed(2)}</div>
          </div>
          {payoutGroups.length ? (
            <div className="space-y-5">
              {payoutGroups.map((group) => (
                <div key={group.tenantId} className="rounded-xl border border-line p-4">
                  <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-cocoa">{group.tenantName}</h3><span className="font-bold text-sage">Payout €{group.payout.toFixed(2)}</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-xs"><thead className="text-left uppercase text-taupe"><tr><th className="py-2">Machine</th><th>Period</th><th className="text-right">Share</th><th className="text-right">Orders</th><th className="text-right">Gross</th><th className="text-right">VAT</th><th className="text-right">Net</th><th className="text-right">Payout</th></tr></thead><tbody className="divide-y divide-line">{group.rows.map((row) => <tr key={row.assignmentId}><td className="py-2 font-semibold text-cocoa">{row.machineName}</td><td>{row.period}</td><td className="text-right">{row.sharePercent}%</td><td className="text-right">{row.orders}</td><td className="text-right">€{row.gross.toFixed(2)}</td><td className="text-right">€{row.vat.toFixed(2)}</td><td className="text-right">€{row.net.toFixed(2)}</td><td className="text-right font-bold text-sage">€{row.payout.toFixed(2)}</td></tr>)}</tbody></table>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-taupe">No completed sales fall within a franchisee assignment period.</p>}
        </section>
      )}

      {/* Revenue trend */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Revenue trend</h2>
        <p className="mb-2 text-xs text-taupe">Daily revenue — hover any point for details</p>
        {revenueTrend.length > 0 ? <LineChart data={revenueTrend} color="#d47e54" height={220} unit="€" /> : <p className="flex h-40 items-center justify-center text-sm text-taupe">No data.</p>}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Revenue by weekday */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Revenue by day of week</h2>
          <p className="mb-3 text-xs text-taupe">Which days sell best</p>
          {weekdayData.some((d) => d.value > 0) ? (
            <VBarChart data={weekdayData} color="#d47e54" formatValue={(v) => `€${v.toFixed(0)}`} />
          ) : <p className="flex h-52 items-center justify-center text-sm text-taupe">No data.</p>}
        </section>

        {/* Revenue by hour */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Revenue by hour</h2>
          <p className="mb-3 text-xs text-taupe">Peak sales hours · scroll horizontally to see all hours</p>
          {hourData.length > 0 ? (
            <div className="overflow-x-auto pb-2">
              <div style={{ minWidth: Math.max(560, hourData.length * 64) }}>
                <VBarChart data={hourData} color="#6fa98c" formatValue={(v) => `€${v.toFixed(0)}`} />
              </div>
            </div>
          ) : <p className="flex h-52 items-center justify-center text-sm text-taupe">No data.</p>}
        </section>
      </div>

      {/* Machine performance */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Machine performance</h2>
        <p className="mb-3 text-xs text-taupe">Revenue by machine — click a bar to open that machine</p>
        {machineBars.length > 0 ? (
          <VBarChart data={machineBars} color="#d47e54" formatValue={(v) => `€${v.toFixed(0)}`} />
        ) : <p className="flex h-52 items-center justify-center text-sm text-taupe">No data.</p>}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Topping consumption */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Ingredient consumption</h2>
          <p className="mb-3 text-xs text-taupe">Times each hopper ingredient was served</p>
          {topToppings.length > 0 ? <HBarChart data={topToppings} color="#d47e54" unit="×" /> : <p className="flex h-32 items-center justify-center text-sm text-taupe">No data.</p>}
        </section>

        {/* Payment types */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Payment methods</h2>
          <p className="mb-3 text-xs text-taupe">Orders by payment type</p>
          {payTypeData.length > 0 ? <HBarChart data={payTypeData} color="#6fa98c" unit="×" /> : <p className="flex h-32 items-center justify-center text-sm text-taupe">No data.</p>}
        </section>
      </div>

      {source === "sample" && <p className="mt-4 text-xs text-taupe">Sample data.</p>}
    </div>
  );
}
