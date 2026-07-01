import { getOrders } from "@/lib/data/orders";

export const dynamic = "force-dynamic";

function StatePill({ state }: { state: string }) {
  const map: Record<string, string> = {
    COMPLETE: "bg-sage/15 text-sage",
    PAID: "bg-sage/10 text-sage",
    FAILURE: "bg-danger/15 text-danger",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${map[state] ?? "bg-cream text-taupe"}`}>
      {state}
    </span>
  );
}

export default async function OrdersPage() {
  const { orders, source } = await getOrders();
  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Orders</h1>
        <p className="mt-1 text-sm text-taupe">Recent sales from your machines</p>
      </header>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-5 py-3 font-bold">Time</th>
              <th className="px-5 py-3 font-bold">Machine</th>
              <th className="px-5 py-3 font-bold">Order #</th>
              <th className="px-5 py-3 font-bold">Product</th>
              <th className="px-5 py-3 text-right font-bold">Price</th>
              <th className="px-5 py-3 text-right font-bold">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-cream/50">
                <td className="px-5 py-3 text-cocoa">
                  {new Date(o.order_time).toLocaleString()}
                </td>
                <td className="px-5 py-3 font-semibold text-cocoa">{o.machine_name ?? o.device_imei ?? "—"}</td>
                <td className="px-5 py-3 font-mono text-xs text-taupe">{o.order_code}</td>
                <td className="px-5 py-3 text-cocoa">{o.product_name}</td>
                <td className="px-5 py-3 text-right font-semibold text-cocoa">€{o.price.toFixed(2)}</td>
                <td className="px-5 py-3 text-right">
                  <StatePill state={o.order_state} />
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-taupe">
                  No orders in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {source === "sample" && (
        <p className="mt-4 text-xs text-taupe">Sample data — connect Supabase to see live orders.</p>
      )}
    </div>
  );
}
