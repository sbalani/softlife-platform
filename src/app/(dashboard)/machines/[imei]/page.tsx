import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachineConfig } from "@/lib/data/machine-config";
import { getMachineDetail, getMachineMedia, getMachineMenu, getMachineSettings, getMachineStatus } from "@/lib/data/machine-detail";
import { getMachineLotHistory } from "@/lib/data/lot-audit";
import { translateStatusDesc, translateStatusValue } from "@/lib/i18n/huaxin";
import { getTenants } from "@/lib/data/franchisees";
import { getProducts } from "@/lib/data/products";
import { getMachines } from "@/lib/data/machines";
import { getPendingMenuDraft } from "@/lib/data/menu-drafts";
import { formatDateTime, formatDate } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { MachineConfigForm } from "./MachineConfigForm";
import { DraftBulkActions } from "./DraftBulkActions";
import { DismissDraftButton } from "./DismissDraftButton";
import { MachinePushButton } from "./MachinePushButton";
import { RemoteControls } from "./RemoteControls";
import { MediaManager } from "./MediaManager";
import { DeviceBrandingForm } from "./DeviceBrandingForm";
import { MachineSyncButton } from "./MachineSyncButton";
import { ProductEditor } from "./ProductEditor";
import { BaseHopperCard } from "./BaseHopperCard";
import { PushSolidToppingsButton } from "./PushSolidToppingsButton";
import { ComboEditor, type HopperIngredientOption } from "./ComboEditor";
import { CopyMenuButton } from "./CopyMenuButton";
import { DeviceSettingsPanel } from "./DeviceSettingsPanel";
import { LogLotForm } from "./LogLotForm";
import { AreaChart } from "@/components/charts";
import { MachineMap } from "@/components/maps";
import { translateLocation } from "@/lib/i18n/huaxin";

export const dynamic = "force-dynamic";

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ imei: string }>;
}) {
  const { imei } = await params;
  const tz = await getDisplayTimezone();
  const config = await getMachineConfig(imei);
  const tenants = await getTenants();
  const telemetry = await getMachineDetail(imei);
  const menu = await getMachineMenu(imei);
  const status = await getMachineStatus(imei);
  const media = await getMachineMedia(imei);
  const lotHistory = await getMachineLotHistory(imei);
  const ingredients = await getProducts();
  const baseProduct = config?.baseProductId ? ingredients.find((p) => p.id === config.baseProductId) ?? null : null;
  const { machines: allMachines } = await getMachines();
  const otherMachines = allMachines.filter((m) => m.device_imei !== imei).map((m) => ({ id: m.id, name: m.name }));
  const pendingDraft = config?.machineId ? await getPendingMenuDraft(config.machineId) : null;
  const draftByPosition = new Map((pendingDraft?.items ?? []).map((it) => [it.position, it]));

  // Map Huaxin lane numbers to config positions for ingredient linking
  const HUAXIN_TO_CONFIG_POS: Record<string, string> = {
    "2": "solid_1", "3": "solid_2", "4": "solid_3",
    "5": "liquid_1", "6": "liquid_2", "7": "liquid_3",
  };
  const linkedProductIdByLane = new Map(
    (config?.ingredients ?? []).map((ing) => [ing.position, ing.product_id ?? null]),
  );

  // What a combo can actually be built from — only what's currently loaded in
  // this machine's hoppers, since that's all it can physically dispense.
  const CONFIG_POSITION_LABELS: Record<string, string> = {
    solid_1: "Solid Topping 1", solid_2: "Solid Topping 2", solid_3: "Solid Topping 3",
    liquid_1: "Liquid Topping 1", liquid_2: "Liquid Topping 2", liquid_3: "Liquid Topping 3",
  };
  const hopperIngredients: HopperIngredientOption[] = [
    ...(baseProduct ? [{ id: baseProduct.id, label: `${baseProduct.name} (Base)`, name: baseProduct.name, price: baseProduct.price }] : []),
    ...(config?.ingredients ?? [])
      .map((ing) => {
        const p = ing.product_id ? ingredients.find((x) => x.id === ing.product_id) : null;
        if (!p) return null;
        const posLabel = CONFIG_POSITION_LABELS[ing.position] ?? ing.position;
        return { id: p.id, label: `${p.name} (${posLabel})`, name: p.name, price: p.price };
      })
      .filter((x): x is HopperIngredientOption => !!x),
  ];

  if (!config && !telemetry) notFound();

  const name = config?.displayName ?? config?.name ?? telemetry?.name ?? imei;
  // config.location is already override-or-translated; the telemetry fallback
  // is the raw Huaxin value and still needs translating.
  const location = config?.location ?? translateLocation(telemetry?.location) ?? null;
  const online = telemetry?.online ?? false;

  return (
    <div>
      <Link href="/machines" className="text-sm font-semibold text-terracotta">← Machines</Link>

      <header className="mt-3 mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="break-words font-display text-2xl font-bold text-cocoa sm:text-3xl">{name}</h1>
          <p className="mt-1 break-words text-sm text-taupe">
            {location ?? "—"} · IMEI {imei}
            {config?.nayaxId && <span className="ml-2 rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold text-taupe">Nayax: {config.nayaxId}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${online ? "bg-sage/15 text-sage" : "bg-taupe/15 text-taupe"}`}>
            {online ? "Online" : "Offline"}
          </span>
          <MachineSyncButton imei={imei} />
        </div>
      </header>

      {/* Location map */}
      {location && (
        <section className="mb-6 rounded-2xl border border-line bg-white p-5">
          <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Location</h2>
          <p className="mb-3 text-sm text-taupe">{location}</p>
          <MachineMap address={location} lat={config?.latitude ?? null} lng={config?.longitude ?? null} />
        </section>
      )}

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
                    {ing.last_loaded_date && <span className="ml-2 text-taupe">· {formatDate(ing.last_loaded_date, tz)}</span>}
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
            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="text-left text-[10px] uppercase text-taupe"><tr><th className="py-1">Date</th><th className="py-1">Position</th><th className="py-1">Product</th><th className="py-1">Lot</th><th className="py-1 text-right">Qty</th></tr></thead>
              <tbody className="divide-y divide-line">
                {lotHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1 text-cocoa">{formatDate(h.device_event_time, tz)}</td>
                    <td className="py-1 text-taupe">{h.position ?? "—"}</td>
                    <td className="py-1 text-cocoa">{h.product_name ?? "—"}</td>
                    <td className="py-1 font-mono text-cocoa">{h.lot_name}</td>
                    <td className="py-1 text-right text-cocoa">{h.quantity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-cocoa">Product menu on machine (live, editable)</h2>
          <div className="flex items-center gap-3">
            <CopyMenuButton sourceImei={imei} machines={otherMachines} />
          </div>
        </div>
        {menu.diy.length > 0 || menu.unify.length > 0 ? (
          <div className="space-y-4">
            {pendingDraft && pendingDraft.items.length > 0 && (
              <div className="flex items-center justify-between rounded-xl border border-terracotta/40 bg-terracotta/5 px-4 py-2.5">
                <div className="text-xs">
                  <span className="font-bold text-terracotta">{pendingDraft.items.length} draft item(s) pending</span>
                  <span className="ml-2 text-taupe">— values shown below are draft edits, not live data.</span>
                </div>
                <div className="flex items-center gap-2">
                  {pendingDraft.items.length > 1 && (
                    <DraftBulkActions imei={imei} draftId={pendingDraft.id} count={pendingDraft.items.length} />
                  )}
                  <DismissDraftButton imei={imei} draftId={pendingDraft.id} />
                </div>
              </div>
            )}
            {menu.unify.length > 0 && (
              <div>
                <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Menu items (recipes / combos)</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {menu.unify.map((item, i) => (
                    <ComboEditor
                      key={i}
                      imei={imei}
                      machineId={config?.machineId ?? null}
                      item={item}
                      hopperIngredients={hopperIngredients}
                      draftId={pendingDraft?.id ?? null}
                      draftItem={draftByPosition.get(String(item.position)) ?? null}
                    />
                  ))}
                </div>
              </div>
            )}
            {menu.diy.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[11px] uppercase tracking-wide text-taupe">Hoppers / ingredients</h3>
                  {config?.machineId && <PushSolidToppingsButton imei={imei} />}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {menu.diy.map((item, i) =>
                    String(item.position) === "1" ? (
                      <BaseHopperCard
                        key={i}
                        imei={imei}
                        machineId={config?.machineId ?? null}
                        item={item}
                        bases={ingredients.filter((p) => p.type === "base").map((p) => ({ id: p.id, name: p.name, name_es: p.name_translations?.es, price: p.price, image_url: p.image_url, allergen_url: p.allergen_url }))}
                        linkedBaseId={config?.baseProductId ?? null}
                        draftId={pendingDraft?.id ?? null}
                        draftItem={draftByPosition.get(String(item.position)) ?? null}
                      />
                    ) : (
                      <ProductEditor
                        key={i}
                        imei={imei}
                        machineId={config?.machineId ?? null}
                        item={item}
                        ingredients={ingredients.map((p) => ({ id: p.id, name: p.name, name_es: p.name_translations?.es, price: p.price, image_url: p.image_url, allergen_url: p.allergen_url }))}
                        linkedProductId={linkedProductIdByLane.get(HUAXIN_TO_CONFIG_POS[String(item.position)] ?? "") ?? null}
                        draftId={pendingDraft?.id ?? null}
                        draftItem={draftByPosition.get(String(item.position)) ?? null}
                      />
                    ),
                  )}
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
            <span className="text-xs text-taupe">Last report {formatDateTime(telemetry.last_report, tz)}</span>
          )}
        </div>
        {telemetry && telemetry.temperatures.length ? (
          <div className="mt-3">
            <AreaChart data={telemetry.temperatures.map((t) => ({ label: t.time ?? "", value: t.value }))} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-taupe">No temperature readings in the last 24 hours.</p>
        )}
      </section>

      {/* Orders */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Recent orders</h2>
        {telemetry && telemetry.orders.length ? (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-taupe">
              <tr><th className="py-2">Time</th><th className="py-2">Order #</th><th className="py-2">Product</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">State</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {telemetry.orders.slice(0, 20).map((o) => (
                <tr key={o.order_code}>
                  <td className="py-2 text-cocoa">{formatDateTime(o.order_time, tz)}</td>
                  <td className="py-2 font-mono text-xs text-taupe">{o.order_code}</td>
                  <td className="py-2 text-cocoa">{o.product_name || "—"}</td>
                  <td className="py-2 text-right text-cocoa">€{o.price.toFixed(2)}</td>
                  <td className="py-2 text-right text-cocoa">{o.order_state}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="text-sm text-taupe">No orders in the last 7 days.</p>
        )}
      </section>
    </div>
  );
}
