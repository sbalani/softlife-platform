import Link from "next/link";
import { LineChart } from "@/components/LineChart";
import { HBarChart, KpiCard } from "@/components/charts";
import { MachineChartClient } from "./MachineChartClient";
import { getOrders } from "@/lib/data/orders";
import { getMachines } from "@/lib/data/machines";
import { getAlerts } from "@/lib/data/alerts";
import { ymd } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getAliasMap, resolveProductName } from "@/lib/data/products";
import { OrderDataNote } from "@/components/order-data-note";
import { getAccessibleMachineIds } from "@/lib/data/accessible-machines";
import { createServiceClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { analyticsPresetRange, analyticsRange, type AnalyticsPeriodPreset } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function dayKey(iso: string, tz: string): string {
  return ymd(new Date(iso.replace(" ", "T")), tz);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ dateFrom?: string; dateTo?: string }> }) {
  const [params, tz] = await Promise.all([searchParams, getDisplayTimezone()]);
  const now = new Date();
  const range = analyticsRange(params, tz);
  const [machineScope, session] = await Promise.all([getAccessibleMachineIds(), getSessionProfile()]);
  const scopedClient = machineScope === null ? undefined : await createServiceClient();
  const [orderResult, machineResult, { alerts, source: alertsSource }, aliasMap] = await Promise.all([
    machineScope?.length === 0 ? Promise.resolve({ orders: [], sync: null, readError: undefined }) : getOrders({ dateFrom: range.from, dateTo: range.to, timeZone: tz }, scopedClient),
    getMachines(),
    getAlerts(false, machineScope ?? undefined),
    getAliasMap(),
  ]);
  const machineIds = machineScope && new Set(machineScope);
  const machines = machineIds ? machineResult.machines.filter((machine) => machineIds.has(machine.id)) : machineResult.machines;
  const allowedImeis = new Set(machines.flatMap((machine) => machine.device_imei ? [machine.device_imei] : []));
  const orders = machineScope === null ? orderResult.orders : orderResult.orders.filter((order) => !!order.device_imei && allowedImeis.has(order.device_imei));
  const { sync, readError } = orderResult;
  const completed = orders.filter((o) => o.order_state === "COMPLETE" && !o.is_admin_override && o.refund_status !== "Refunded");
  const totalSales = completed.reduce((s, o) => s + o.price, 0);
  const totalUnits = completed.reduce((s, o) => s + o.nums, 0);
  const dailyAverageUnits = totalUnits / range.days;

  const online = machines.filter((m) => m.net_online).length;
  const critical = alerts.filter((a) => a.severity === "critical").length;

  // Sales line chart: revenue per day (last 14 days with data)
  const revenueByDay = new Map<string, number>();
  for (const o of completed) {
    const key = dayKey(o.order_time, tz);
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + o.price);
  }
  const sortedDays = [...revenueByDay.keys()].sort();
  const recentDays = sortedDays.slice(-14);
  const salesLineData = recentDays.map((d) => ({
    label: new Date(d).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: tz }),
    value: Number((revenueByDay.get(d) ?? 0).toFixed(2)),
  }));
  // Topping consumption: count each product sub-item across completed orders
  const productCounts = new Map<string, number>();
  for (const o of completed) {
    const names = o.products.length ? o.products.map((p) => p.goodsName ?? "") : [o.product_name];
    for (const n of names) {
      if (!n) continue;
      const resolved = resolveProductName(n, aliasMap);
      productCounts.set(resolved, (productCounts.get(resolved) ?? 0) + 1);
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
    .map(([label, v]) => {
      const machine = machines.find((m) => m.name === label);
      return {
        label,
        value: Number(v.revenue.toFixed(2)),
        units: v.units,
        href: session?.role === "admin" && machine?.device_imei ? `/machines/${machine.device_imei}` : undefined,
      };
    });
  const unitsByMachine = new Map<string, number>();
  for (const order of completed) {
    if (!order.machine_id) continue;
    unitsByMachine.set(order.machine_id, (unitsByMachine.get(order.machine_id) ?? 0) + order.nums);
  }
  const machineDailyAverages = machines
    .filter((machine) => machine.deployed || unitsByMachine.has(machine.id))
    .map((machine) => ({
      id: machine.id,
      name: machine.display_name || machine.name,
      imei: machine.device_imei,
      units: unitsByMachine.get(machine.id) ?? 0,
      average: (unitsByMachine.get(machine.id) ?? 0) / range.days,
    }))
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  const presetUrl = (preset: AnalyticsPeriodPreset) => {
    const period = analyticsPresetRange(preset, tz, now);
    return `/dashboard?${new URLSearchParams({ dateFrom: period.from, dateTo: period.to })}`;
  };
  const periodLabel = `${range.from} to ${range.to}`;
  const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
  const activeRollingDays = range.to === range.today ? range.days : null;

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">Dashboard</h1>
          <p className="mt-1 text-sm text-taupe">Fleet performance · {periodLabel} · Refunds and admin tests excluded</p>
        </div>
      </header>

      <section className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4" aria-label="Dashboard period">
        <div className="basis-full sm:basis-auto sm:pr-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-taupe">KPI period</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([30, 10, 7] as const).map((days) => <Link key={days} href={presetUrl(`last-${days}-days` as AnalyticsPeriodPreset)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${activeRollingDays === days ? "border-terracotta bg-terracotta text-white" : "border-line text-cocoa hover:border-terracotta"}`}>Last {days} days</Link>)}
          </div>
        </div>
        <form className="flex flex-wrap items-end gap-2 sm:border-l sm:border-line sm:pl-4">
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe">Custom from</span><input type="date" name="dateFrom" defaultValue={range.from} max={range.today} className={input} /></label>
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe">Custom to</span><input type="date" name="dateTo" defaultValue={range.to} max={range.today} className={input} /></label>
          <button className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Apply</button>
        </form>
      </section>

      <OrderDataNote sync={sync} readError={readError} requestedTo={range.to} timeZone={tz} />

      {/* KPI cards */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Revenue" value={`€${totalSales.toFixed(2)}`} hint={`${totalUnits} units sold`} accent="#d47e54" />
        <KpiCard label="Daily average units sold" value={dailyAverageUnits.toFixed(1)} hint={`${totalUnits} net units ÷ ${range.days} calendar day${range.days === 1 ? "" : "s"}`} accent="#6fa98c" />
        <KpiCard label="Machines online" value={`${online}`} hint={`of ${machines.length} machines`} accent="#6fa98c" />
        <KpiCard label="Completed orders" value={`${completed.length}`} hint={`${(completed.length / range.days).toFixed(1)} per calendar day`} accent="#d47e54" />
        <KpiCard
          label="Open alerts"
          value={`${alertsSource === "sample" ? "—" : alerts.length}`}
          hint={alertsSource === "sample" ? "no alert data yet" : `${critical} critical`}
          accent="#dc2626"
        />
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="font-display text-lg font-bold text-cocoa">Daily average units by machine</h2><p className="text-xs text-taupe">Net units sold divided by {range.days} calendar day{range.days === 1 ? "" : "s"}, including zero-sale days.</p></div>
          <p className="text-xs font-semibold text-taupe">{periodLabel}</p>
        </div>
        {machineDailyAverages.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{machineDailyAverages.map((machine) => {
          const content = <><div className="min-w-0"><p className="truncate text-sm font-bold text-cocoa">{machine.name}</p><p className="mt-0.5 text-xs text-taupe">{machine.units} unit{machine.units === 1 ? "" : "s"} in period</p></div><div className="text-right"><p className="font-display text-2xl font-bold text-terracotta">{machine.average.toFixed(2)}</p><p className="text-[10px] font-bold uppercase tracking-wide text-taupe">units / day</p></div></>;
          const className = "flex items-center justify-between gap-3 rounded-xl border border-line bg-cream/35 p-4 transition hover:border-terracotta/50";
          return session?.role === "admin" && machine.imei ? <Link key={machine.id} href={`/machines/${machine.imei}`} className={className}>{content}</Link> : <div key={machine.id} className={className}>{content}</div>;
        })}</div> : <p className="mt-4 text-sm text-taupe">No deployed machines are available.</p>}
      </section>

      {/* Sales line chart */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Sales trend</h2>
        <p className="mb-2 text-xs text-taupe">Revenue per day — hover any point for details</p>
        {salesLineData.length > 0 ? (
          <LineChart data={salesLineData} color="#d47e54" height={200} unit="€" />
        ) : (
          <p className="flex h-40 items-center justify-center text-sm text-taupe">No sales data yet.</p>
        )}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Topping consumption */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Topping consumption</h2>
          <p className="mb-3 text-xs text-taupe">How many times each hopper ingredient was served. Names come from the machine&apos;s own hopper labels.</p>
          {topToppings.length > 0 ? (
            <HBarChart data={topToppings} color="#d47e54" unit="×" />
          ) : (
            <p className="flex h-32 items-center justify-center text-sm text-taupe">No consumption data.</p>
          )}
        </section>

        {/* Best-selling combos */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Best-selling combos</h2>
          <p className="mb-3 text-xs text-taupe">Orders with 2+ toppings, by frequency. Each combo is the set of toppings in one order.</p>
          {topCombos.length > 0 ? (
            <HBarChart data={topCombos} color="#6fa98c" unit="×" />
          ) : (
            <p className="flex h-32 items-center justify-center text-sm text-taupe">No multi-ingredient orders yet.</p>
          )}
        </section>
      </div>

      {/* Machine bar chart */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <MachineChartClient data={topMachines} periodLabel={periodLabel} />
      </section>

    </div>
  );
}
