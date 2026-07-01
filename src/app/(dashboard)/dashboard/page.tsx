import { AreaChart, KpiCard, VBarChart } from "@/components/charts";

export const dynamic = "force-dynamic";

const TOPPINGS = [
  { label: "Oreo", value: 420 },
  { label: "Rainbow", value: 380 },
  { label: "Hazelnut", value: 260 },
  { label: "Chocolate", value: 210 },
  { label: "Caramel", value: 160 },
];

const SAUCES = [
  { label: "Chocolate", value: 300 },
  { label: "Caramel", value: 250 },
  { label: "Strawberry", value: 180 },
  { label: "White Choc", value: 120 },
];

const TOP_MACHINES = [
  { label: "B84MAX-001", value: 1280 },
  { label: "B84MAX-002", value: 940 },
  { label: "B84MAX-003", value: 760 },
];

export default function DashboardPage() {
  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">Dashboard</h1>
          <p className="mt-1 text-sm text-taupe">Fleet performance overview</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <select className="rounded-lg border border-line bg-white px-3 py-2 text-cocoa">
            <option>YTD</option>
            <option>Last 30 days</option>
            <option>Last 7 days</option>
          </select>
          <select className="rounded-lg border border-line bg-white px-3 py-2 text-cocoa">
            <option>Top 5</option>
            <option>Top 10</option>
            <option>All</option>
          </select>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total sales" value="€4,820" hint="this month" accent="#d47e54" />
        <KpiCard label="Active machines" value="3" hint="of 3 online" accent="#6fa98c" />
        <KpiCard label="Orders today" value="18" hint="vs 12 yesterday" accent="#d47e54" />
        <KpiCard label="Open alerts" value="2" hint="1 critical" accent="#dc2626" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Best Performing Toppings YTD</h2>
          <p className="mb-2 text-xs text-taupe">Servings per topping</p>
          <AreaChart data={TOPPINGS} color="#d47e54" />
        </section>
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-bold text-cocoa">Best Performing Sauces YTD</h2>
          <p className="mb-2 text-xs text-taupe">Servings per sauce</p>
          <AreaChart data={SAUCES} color="#6fa98c" />
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Top Machines by Sales</h2>
        <VBarChart data={TOP_MACHINES} color="#d47e54" />
      </section>

      <p className="mt-4 text-xs text-taupe">Sample data — connect Supabase + run the Huaxin sync for live analytics.</p>
    </div>
  );
}
