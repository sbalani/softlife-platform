import { AreaChart, KpiCard, VBarChart } from "@/components/charts";
import { getOrders } from "@/lib/data/orders";
import { getMachines } from "@/lib/data/machines";
import { getAlerts } from "@/lib/data/alerts";

export const dynamic = "force-dynamic";

function isSameDay(iso: string, ref: Date) {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

export default async function DashboardPage() {
  const [{ orders, source: ordersSource }, { machines }, { alerts, source: alertsSource }] = await Promise.all([
    getOrders(),
    getMachines(),
    getAlerts(),
  ]);

  const completed = orders.filter((o) => o.order_state === "COMPLETE");
  const totalSales = completed.reduce((s, o) => s + o.price, 0);

  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const ordersToday = orders.filter((o) => isSameDay(o.order_time, today)).length;
  const ordersYesterday = orders.filter((o) => isSameDay(o.order_time, yesterday)).length;

  const online = machines.filter((m) => m.net_online).length;
  const critical = alerts.filter((a) => a.severity === "critical").length;

  // Servings per product across completed orders (each order line's goodsName).
  const productCounts = new Map<string, number>();
  for (const o of completed) {
    const names = o.products.length ? o.products.map((p) => p.goodsName ?? "") : [o.product_name];
    for (const n of names) {
      if (!n) continue;
      productCounts.set(n, (productCounts.get(n) ?? 0) + 1);
    }
  }
  const topProducts = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }));

  const machineRevenue = new Map<string, number>();
  for (const o of completed) {
    const name = o.machine_name ?? o.device_imei ?? "Unknown";
    machineRevenue.set(name, (machineRevenue.get(name) ?? 0) + o.price);
  }
  const topMachines = [...machineRevenue.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value: Number(value.toFixed(2)) }));

  const isSample = ordersSource === "sample";

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Dashboard</h1>
        <p className="mt-1 text-sm text-taupe">Fleet performance — last 30 days</p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total sales" value={`€${totalSales.toFixed(2)}`} hint="completed orders, 30 days" accent="#d47e54" />
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

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Top Products</h2>
          <p className="mb-2 text-xs text-taupe">Servings per product, completed orders (30 days)</p>
          <AreaChart data={topProducts} color="#d47e54" />
        </section>
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Top Machines by Sales</h2>
          <p className="mb-2 text-xs text-taupe">Completed order revenue (€, 30 days)</p>
          <VBarChart data={topMachines} color="#6fa98c" />
        </section>
      </div>

      {isSample && (
        <p className="mt-4 text-xs text-taupe">Sample data — connect Supabase + Huaxin keys in .env.local for live analytics.</p>
      )}
    </div>
  );
}
