import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachineConfig } from "@/lib/data/machine-config";
import { getMachineDetail, getMachineMenu, getMachineStatus, getMachineMedia } from "@/lib/data/machine-detail";
import { MachineConfigForm } from "./MachineConfigForm";
import { MachinePushButton } from "./MachinePushButton";
import { RemoteControls } from "./RemoteControls";
import { MediaManager } from "./MediaManager";
import { AreaChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ imei: string }>;
}) {
  const { imei } = await params;
  const [config, telemetry, menu, status, media] = await Promise.all([
    getMachineConfig(imei),
    getMachineDetail(imei),
    getMachineMenu(imei),
    getMachineStatus(imei),
    getMachineMedia(imei),
  ]);

  if (!config && !telemetry) notFound();

  const name = config?.name ?? telemetry?.name ?? imei;
  const location = config?.location ?? telemetry?.location ?? null;
  const online = telemetry?.online ?? false;

  return (
    <div>
      <Link href="/machines" className="text-sm font-semibold text-terracotta">← Machines</Link>

      <header className="mt-3 mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">{name}</h1>
          <p className="mt-1 text-sm text-taupe">{location ?? "—"} · IMEI {imei}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${online ? "bg-sage/15 text-sage" : "bg-taupe/15 text-taupe"}`}>
          {online ? "Online" : "Offline"}
        </span>
      </header>

      {/* Configuration + Push + Remote */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Configuration &amp; control</h2>
        {config ? (
          <>
            <MachineConfigForm config={config} imei={imei} />
            <div className="mt-5 space-y-4 border-t border-line pt-4">
              <MachinePushButton imei={imei} />
              <div>
                <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Remote commands</h3>
                <RemoteControls imei={imei} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-taupe">Sync this machine to Supabase first (Settings → Sync now) to configure and control it.</p>
        )}
      </section>

      {/* Live status */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Live status</h2>
        {status.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {status.map((s, i) => (
              <div key={i} className="rounded-lg bg-cream/50 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-taupe">{s.desc || s.code}</div>
                <div className="text-sm font-semibold text-cocoa">{s.value ?? "—"}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-taupe">No status parameters available.</p>
        )}
      </section>

      {/* Screen media */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Screen media (advertising)</h2>
        <MediaManager imei={imei} media={media} />
      </section>

      {/* Product menu */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Product menu on machine (live)</h2>
        {menu.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {menu.map((item, i) => (
              <div key={item.position ?? i} className="rounded-xl border border-line p-3 text-center">
                {item.imagePath ? (
                  <img src={item.imagePath} alt={item.goodsName} className="mx-auto h-14 w-14 rounded-lg object-cover" />
                ) : (
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-cream text-taupe">—</div>
                )}
                <div className="mt-2 text-sm font-semibold text-cocoa">{item.goodsName ?? `Lane ${item.position}`}</div>
                <div className="text-xs text-taupe">Lane {item.position}{item.price ? ` · €${item.price}` : ""}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-taupe">No product menu reported by the machine.</p>
        )}
      </section>

      {/* Temperature */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-cocoa">Cylinder temperature</h2>
          {telemetry?.last_report && (
            <span className="text-xs text-taupe">Last report {new Date(telemetry.last_report.replace(" ", "T")).toLocaleString()}</span>
          )}
        </div>
        {telemetry && telemetry.temperatures.length ? (
          <div className="mt-3">
            <AreaChart data={telemetry.temperatures.map((t) => ({ label: t.time ? new Date(t.time.replace(" ", "T")).toLocaleTimeString() : "", value: t.value }))} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-taupe">No temperature readings in the last 7 days.</p>
        )}
      </section>

      {/* Orders */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Recent orders</h2>
        {telemetry && telemetry.orders.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-taupe">
              <tr><th className="py-2">Time</th><th className="py-2">Order #</th><th className="py-2">Product</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">State</th></tr>
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
