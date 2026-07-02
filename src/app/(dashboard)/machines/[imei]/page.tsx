import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachineConfig } from "@/lib/data/machine-config";
import { getMachineDetail } from "@/lib/data/machine-detail";
import { MachineConfigForm } from "./MachineConfigForm";
import { AreaChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ imei: string }>;
}) {
  const { imei } = await params;
  const [config, telemetry] = await Promise.all([
    getMachineConfig(imei),
    getMachineDetail(imei),
  ]);

  if (!config && !telemetry) notFound();

  const name = config?.name ?? telemetry?.name ?? imei;
  const location = config?.location ?? telemetry?.location ?? null;
  const online = telemetry?.online ?? false;

  return (
    <div>
      <Link href="/machines" className="text-sm font-semibold text-terracotta">
        ← Machines
      </Link>

      <header className="mt-3 mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">{name}</h1>
          <p className="mt-1 text-sm text-taupe">{location ?? "—"} · IMEI {imei}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            online ? "bg-sage/15 text-sage" : "bg-taupe/15 text-taupe"
          }`}
        >
          {online ? "Online" : "Offline"}
        </span>
      </header>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Configuration</h2>
        {config ? (
          <MachineConfigForm config={config} imei={imei} />
        ) : (
          <p className="text-sm text-taupe">
            Sync this machine to Supabase first (Settings → Sync now) to configure base, profile and hoppers.
          </p>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-cocoa">Cylinder temperature</h2>
          {telemetry?.last_report && (
            <span className="text-xs text-taupe">
              Last report {new Date(telemetry.last_report.replace(" ", "T")).toLocaleString()}
            </span>
          )}
        </div>
        {telemetry && telemetry.temperatures.length ? (
          <div className="mt-3">
            <AreaChart
              data={telemetry.temperatures.map((t) => ({
                label: t.time ? new Date(t.time.replace(" ", "T")).toLocaleTimeString() : "",
                value: t.value,
              }))}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-taupe">No temperature readings in the last 7 days.</p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Recent orders</h2>
        {telemetry && telemetry.orders.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-taupe">
              <tr>
                <th className="py-2">Time</th>
                <th className="py-2">Order #</th>
                <th className="py-2">Product</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {telemetry.orders.slice(0, 20).map((o) => (
                <tr key={o.order_code}>
                  <td className="py-2 text-cocoa">{new Date(o.order_time).toLocaleString()}</td>
                  <td className="py-2 font-mono text-xs text-taupe">{o.order_code}</td>
                  <td className="py-2 text-cocoa">{o.product_name || "—"}</td>
                  <td className="py-2 text-right text-cocoa">€{o.price.toFixed(2)}</td>
                  <td className="py-2 text-right text-cocoa">{o.order_state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-taupe">No orders in the last 7 days.</p>
        )}
      </section>
    </div>
  );
}
