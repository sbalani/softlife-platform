import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachineConfig } from "@/lib/data/machine-config";
import { getMachineDetail, getMachineMedia, getMachineMenu, getMachineSettings, getMachineStatus } from "@/lib/data/machine-detail";
import { getMachineLotHistory } from "@/lib/data/lot-audit";
import { translateStatusDesc, translateStatusValue } from "@/lib/i18n/huaxin";
import { getTenants } from "@/lib/data/franchisees";
import { getProducts } from "@/lib/data/products";
import { MachineConfigForm } from "./MachineConfigForm";
import { MachinePushButton } from "./MachinePushButton";
import { RemoteControls } from "./RemoteControls";
import { MediaManager } from "./MediaManager";
import { DeviceBrandingForm } from "./DeviceBrandingForm";
import { MachineSyncButton } from "./MachineSyncButton";
import { ProductEditor } from "./ProductEditor";
import { DeviceSettingsPanel } from "./DeviceSettingsPanel";
import { LogLotForm } from "./LogLotForm";
import { AreaChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ imei: string }>;
}) {
  const { imei } = await params;
  const config = await getMachineConfig(imei);
  const tenants = await getTenants();
  const telemetry = await getMachineDetail(imei);
  const menu = await getMachineMenu(imei);
  const status = await getMachineStatus(imei);
  const media = await getMachineMedia(imei);
  const lotHistory = await getMachineLotHistory(imei);
  const ingredients = await getProducts();

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
        <MachineSyncButton imei={imei} />
      </header>

      {/* Configuration + Push + Remote */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Configuration &amp; control</h2>
        {config ? (
          <>
            <MachineConfigForm config={config} imei={imei} tenants={tenants} />
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

      {/* Lots & traceability */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Lots &amp; traceability</h2>
        {config && config.ingredients.length > 0 ? (
          <>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {config.ingredients.map((ing) => (
                <div key={ing.position} className="rounded-lg border border-line px-3 py-2">
                  <div className="text-xs font-bold text-cocoa">{ing.position}</div>
                  <div className="text-xs capitalize text-taupe">{ing.product_type}</div>
                  <div className="mt-1 text-xs">
                    {ing.current_lot_name ? (
                      <span className="font-semibold text-sage">Lot: {ing.current_lot_name}</span>
                    ) : (
                      <span className="text-taupe">No lot recorded</span>
                    )}
                    {ing.last_loaded_date && <span className="ml-2 text-taupe">· {new Date(ing.last_loaded_date).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-line pt-3">
              <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Log a lot</h3>
              <LogLotForm machineId={config.machineId!} imei={imei} machineName={config.name} ingredients={config.ingredients} />
            </div>
          </>
        ) : (
          <p className="text-sm text-taupe">Configure hoppers first to track lots per ingredient.</p>
        )}
        {lotHistory.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Recent lot history</h3>
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase text-taupe"><tr><th className="py-1">Date</th><th className="py-1">Position</th><th className="py-1">Product</th><th className="py-1">Lot</th><th className="py-1 text-right">Qty</th></tr></thead>
              <tbody className="divide-y divide-line">
                {lotHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1 text-cocoa">{new Date(h.device_event_time).toLocaleDateString()}</td>
                    <td className="py-1 text-taupe">{h.position ?? "—"}</td>
                    <td className="py-1 text-cocoa">{h.product_name ?? "—"}</td>
                    <td className="py-1 font-mono text-cocoa">{h.lot_name}</td>
                    <td className="py-1 text-right text-cocoa">{h.quantity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Branding */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Branding (machine screen)</h2>
        <p className="mb-3 text-xs text-taupe">Updates the display label, merchant, phone and language shown on the machine.</p>
        <DeviceBrandingForm imei={imei} />
      </section>

      {/* Live status */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Live status</h2>
        {status.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {status.map((s, i) => {
              const desc = translateStatusDesc(s.desc ?? s.code).toLowerCase();
              const val = translateStatusValue(s.value);
              let tone = "";
              if (desc.includes("formation ratio") || desc.includes("form") && desc.includes("ratio")) {
                const num = parseFloat(val);
                if (num === 0) tone = "text-danger font-bold";
                else if (num === 100) tone = "text-sage font-bold";
                else tone = "text-warning font-bold";
              }
              return (
                <div key={i} className="rounded-lg bg-cream/50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-taupe">{translateStatusDesc(s.desc ?? s.code)}</div>
                  <div className={`text-sm font-semibold ${tone || "text-cocoa"}`}>{val}</div>
                </div>
              );
            })}
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
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Product menu on machine (live, editable)</h2>
        {menu.diy.length > 0 || menu.unify.length > 0 ? (
          <div className="space-y-4">
            {menu.unify.length > 0 && (
              <div>
                <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Menu items (recipes / combos)</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {menu.unify.map((item, i) => (
                    <ProductEditor key={i} imei={imei} item={item} kind="menu" ingredients={ingredients} />
                  ))}
                </div>
              </div>
            )}
            {menu.diy.length > 0 && (
              <div>
                <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Hoppers / ingredients</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {menu.diy.map((item, i) => (
                    <ProductEditor key={i} imei={imei} item={item} kind="hopper" ingredients={ingredients} />
                  ))}
                </div>
              </div>
            )}
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
            <AreaChart data={telemetry.temperatures.map((t) => ({ label: t.time ?? "", value: t.value }))} />
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
