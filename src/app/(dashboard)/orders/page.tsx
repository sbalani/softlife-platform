import Link from "next/link";
import { getOrders } from "@/lib/data/orders";
import { DataSourceNote } from "@/components/data-source-note";

export const dynamic = "force-dynamic";

type SearchParams = { machine?: string; minPrice?: string; maxPrice?: string; couponOnly?: string; refundedOnly?: string };

function qs(sp: SearchParams, overrides: Partial<SearchParams>) {
  const p = new URLSearchParams();
  const merged = { ...sp, ...overrides };
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/orders?${s}` : "/orders";
}

const STATE_TONE: Record<string, string> = {
  COMPLETE: "bg-sage/15 text-sage",
  PAID: "bg-sage/10 text-sage",
  MAKING: "bg-warning/15 text-warning",
  PENDING: "bg-taupe/15 text-taupe",
};

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { orders, source } = await getOrders({
    machine: sp.machine,
    minPrice: sp.minPrice ? Number(sp.minPrice) : undefined,
    maxPrice: sp.maxPrice ? Number(sp.maxPrice) : undefined,
    couponOnly: sp.couponOnly === "1" ? true : undefined,
    refundedOnly: sp.refundedOnly === "1" ? true : undefined,
  });

  const totalRevenue = orders.filter((o) => o.order_state === "COMPLETE").reduce((sum, o) => sum + o.price, 0);
  const couponCount = orders.filter((o) => o.coupon_used).length;
  const refundedCount = orders.filter((o) => o.refund_status === "Refunded").length;

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-cocoa">Orders</h1>
        <p className="mt-1 text-sm text-taupe">{orders.length} order(s) · Revenue €{totalRevenue.toFixed(2)} · {couponCount} coupon(s) · {refundedCount} refund(s)</p>
      </header>

      {/* Filters */}
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={label}>Machine</span>
          <input name="machine" defaultValue={sp.machine} placeholder="Name or IMEI" className={`w-40 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Min price (€)</span>
          <input name="minPrice" type="number" step="0.01" defaultValue={sp.minPrice} className={`w-24 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Max price (€)</span>
          <input name="maxPrice" type="number" step="0.01" defaultValue={sp.maxPrice} className={`w-24 ${input}`} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-cocoa">
          <input type="checkbox" name="couponOnly" value="1" defaultChecked={sp.couponOnly === "1"} className="accent-terracotta" />
          Coupon only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-cocoa">
          <input type="checkbox" name="refundedOnly" value="1" defaultChecked={sp.refundedOnly === "1"} className="accent-terracotta" />
          Refunded only
        </label>
        <button type="submit" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90">Filter</button>
        <Link href="/orders" className="text-sm font-semibold text-terracotta hover:underline">Clear</Link>
      </form>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-4 py-3 font-bold">Time</th>
              <th className="px-4 py-3 font-bold">Machine</th>
              <th className="px-4 py-3 font-bold">Order #</th>
              <th className="px-4 py-3 font-bold">Payment Ref</th>
              <th className="px-4 py-3 font-bold">Products</th>
              <th className="px-4 py-3 font-bold">Pay Type</th>
              <th className="px-4 py-3 text-right font-bold">Market</th>
              <th className="px-4 py-3 text-right font-bold">Paid</th>
              <th className="px-4 py-3 text-right font-bold">Discount</th>
              <th className="px-4 py-3 text-center font-bold">Qty</th>
              <th className="px-4 py-3 font-bold">Coupon</th>
              <th className="px-4 py-3 font-bold">Promo</th>
              <th className="px-4 py-3 font-bold">Refund</th>
              <th className="px-4 py-3 font-bold">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-cream/50">
                <td className="px-4 py-3 text-cocoa whitespace-nowrap">{o.order_time ? new Date(o.order_time.replace(" ", "T")).toLocaleString() : "—"}</td>
                <td className="px-4 py-3 font-semibold text-cocoa whitespace-nowrap">{o.machine_name ?? o.device_imei ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-taupe">{o.order_code}</td>
                <td className="px-4 py-3 font-mono text-xs text-taupe">{o.out_trade_no ?? "—"}</td>
                <td className="px-4 py-3 text-cocoa">
                  {o.products.length > 0 ? (
                    <div className="space-y-0.5">
                      {o.products.map((p, i) => (
                        <div key={i} className="text-xs">
                          <span className="font-semibold">{p.goodsName}</span>
                          <span className="text-taupe"> · pos {p.position}</span>
                          {Number(p.price) > 0 && <span className="text-taupe"> · €{p.price}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    o.product_name || "—"
                  )}
                </td>
                <td className="px-4 py-3 text-taupe whitespace-nowrap">{o.pay_type ?? "—"}</td>
                <td className="px-4 py-3 text-right text-taupe">{o.market_price != null ? `€${o.market_price.toFixed(2)}` : "—"}</td>
                <td className="px-4 py-3 text-right font-semibold text-cocoa">€{o.price.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-taupe">{o.discount_price && o.discount_price > 0 ? `-€${o.discount_price.toFixed(2)}` : "—"}</td>
                <td className="px-4 py-3 text-center text-cocoa">{o.nums}</td>
                <td className="px-4 py-3">
                  {o.coupon_used ? (
                    <span className="rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-bold text-sage">Used</span>
                  ) : (
                    <span className="text-taupe">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-taupe">{o.activity_name && o.activity_name !== "No activity" ? o.activity_name : "—"}</td>
                <td className="px-4 py-3">
                  {o.refund_status === "Refunded" ? (
                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">{o.refund_status}</span>
                  ) : (
                    <span className="text-taupe">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATE_TONE[o.order_state] ?? "bg-cream text-taupe"}`}>{o.order_state}</span>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-10 text-center text-taupe">No orders match your filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <DataSourceNote source={source} />
    </div>
  );
}
