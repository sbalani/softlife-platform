import { AreaChart, HBarChart, KpiCard, VBarChart } from "@/components/charts";
import { getOrders } from "@/lib/data/orders";
import { getMachines } from "@/lib/data/machines";
import { getAlerts } from "@/lib/data/alerts";

export const dynamic = "force-dynamic";

function dayKey(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  return d.toISOString().slice(0, 10);
}

function isSameDay(iso: string, ref: Date) {
  const d = new Date(iso.replace(" ", "T"));
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

export default async function DashboardPage() {
  const [{ orders, source: ordersSource }, { machines }, { alerts, source: alertsSource }] = await Promise.all([
    getOrders(),
    getMachines(),
    getAlerts(),
  ]);

  const completed = orders.filter((o) => o.order_state === "COMPLETE" && !o.is_admin_override);
  const totalSales = completed.reduce((s, o) => s + o.price, 0);
  const totalUnits = completed.reduce((s, o) => s + o.nums, 0);

  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const ordersToday = orders.filter((o) => isSameDay(o.order_time, today)).length;
  const ordersYesterday = orders.filter((o) => isSameDay(o.order_time, yesterday)).length;

  const online = machines.filter((m) => m.net_online).length;
  const critical = alerts.filter((a) => a.severity === "critical").length;

  // Sales line chart: revenue per day (last 14 days with data)
  const revenueByDay = new Map<string, number>();
  const unitsByDay = new Map<string, number>();
  for (const o of completed) {
    const key = dayKey(o.order_time);
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + o.price);
    unitsByDay.set(key, (unitsByDay.get(key) ?? 0) + o.nums);
  }
  const sortedDays = [...revenueByDay.keys()].sort();
  const recentDays = sortedDays.slice(-14);
  const salesLineData = recentDays.map((d) => ({
    label: new Date(d).toLocaleDateString("en", { day: "numeric", month: "short" }),
    value: Number((revenueByDay.get(d) ?? 0).toFixed(2)),
  }));
  const unitsLineData = recentDays.map((d) => ({
    label: new Date(d).toLocaleDateString("en", { day: "numeric", month: "short" }),
    value: unitsByDay.get(d) ?? 0,
  }));

  // Topping consumption: count each product sub-item across completed orders
  const productCounts = new Map<string, number>();
  for (const o of completed) {
    const names = o.products.length ? o.products.map((p) => p.goodsName ?? "") : [o.product_name];
    for (const n of names) {
      if (!n) continue;
      productCounts.set(n, (productCounts.get(n) ?? 0) + 1);
    }
  }
  const topToppings = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));

  // Best-selling combos: for orders with multiple products, the combination
  const comboCounts = new Map<string, number>();
  for (const o of completed) {
    if (o.products.length < 2) continue;
    const combo = o.products.map((p) => p.goodsName ?? "?").sort().join(" + ");
    if (combo.includes("?")) continue;
    comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1);
  }
  const topCombos = [...comboCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  // Machine bar chart: revenue per machine
  const machineRevenue = new Map<string, { revenue: number; units: number }>();
  for (const o of completed) {
    const name = o.machine_name ?? o.device_imei ?? "Unknown";
    const prev = machineRevenue.get(name) ?? { revenue: 0, units: 0 };
    machineRevenue.set(name, { revenue: prev.revenue + o.price, units: prev.units + o.nums });
  }
  const topMachines = [...machineRevenue.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 6)
    .map(([label, v]) => ({ label, value: Number(v.revenue.toFixed(2)), units: v.units }));

  const isSample = ordersSource === "sample";

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">Dashboard</h1>
          <p className="mt-1 text-sm text-taupe">Fleet performance — {completed.length} completed orders (30 days)</p>
        </div>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Revenue" value={`€${totalSales.toFixed(2)}`} hint={`${totalUnits} units sold`} accent="#d47e54" />
        <KpiCard label="Machines online" value={`${online}`} hint={`of ${machines.length} machines`} accent="#6fa98c" />
        <KpiCard
          label="Orders today"
          value={`${ordersToday}`}
          hint={`vs ${ordersYesterday} yesterday`}
          accent="#d47e54"
        />
        <KpiCard
          label="Open alerts"
          value={`${alertsSource === "sample" ? "—" : alerts.length}`}
          hint={alertsSource === "sample" ? "no alert data yet" : `${critical} critical`}
          accent="#dc2626"
        />
      </div>

      {/* Sales line chart */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Sales trend</h2>
        <p className="mb-2 text-xs text-taupe">Revenue per day (last 14 active days)</p>
        {salesLineData.length > 0 ? (
          <AreaChart data={salesLineData} color="#d47e54" height={160} />
        ) : (
          <p className="flex h-40 items-center justify-center text-sm text-taupe">No sales data yet.</p>
        )}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Topping consumption */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Topping consumption</h2>
          <p className="mb-3 text-xs text-taupe">Units served per ingredient</p>
          {topToppings.length > 0 ? (
            <HBarChart data={topToppings} color="#d47e54" unit="×" />
          ) : (
            <p className="flex h-32 items-center justify-center text-sm text-taupe">No consumption data.</p>
          )}
        </section>

        {/* Best-selling combos */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Best-selling combos</h2>
          <p className="mb-3 text-xs text-taupe">Multi-ingredient orders, by frequency</p>
          {topCombos.length > 0 ? (
            <HBarChart data={topCombos} color="#6fa98c" unit="×" />
          ) : (
            <p className="flex h-32 items-center justify-center text-sm text-taupe">No multi-ingredient orders yet.</p>
          )}
        </section>
      </div>

      {/* Machine bar chart */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <MachineChartClient data={topMachines} />
      </section>

      {isSample && (
        <p className="mt-4 text-xs text-taupe">Sample data — connect Supabase + Huaxin keys in .env.local for live analytics.</p>
      )}
    </div>
  );
}
