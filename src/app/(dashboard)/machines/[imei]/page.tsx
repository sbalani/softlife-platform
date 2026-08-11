import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachineConfig } from "@/lib/data/machine-config";
import { getMachineDetail } from "@/lib/data/machine-detail";
import { getMachineLotHistory } from "@/lib/data/lot-audit";
import { translateStatusDesc, translateStatusValue } from "@/lib/i18n/huaxin";
import { getTenants } from "@/lib/data/franchisees";
import { getProducts } from "@/lib/data/products";
import { getMachines } from "@/lib/data/machines";
import { getPendingMenuDraft } from "@/lib/data/menu-drafts";
import { getFranchiseeAssignments } from "@/lib/data/franchisee-profit";
import { formatDateTime, formatDate, ymd } from "@/lib/dates";
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
import { LogLotForm } from "./LogLotForm";
import { FranchiseeAssignmentForm } from "./FranchiseeAssignmentForm";
import { LineChart } from "@/components/LineChart";
import { MachineMap } from "@/components/maps";
import { translateLocation } from "@/lib/i18n/huaxin";
import { getRefillHistory } from "@/lib/data/refills";
import { getMachineCleanHistory } from "@/lib/data/clean-logs";
import { MachineServiceQr } from "@/components/MachineServiceQr";
import { faultStatusSignal, materialRemainingStatus, resourceStatusSignal, statusDisplayRank } from "@/lib/huaxin/status-signals";

export const dynamic = "force-dynamic";

export default async function MachineDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ imei: string }>;
  searchParams: Promise<{ dateFrom?: string; dateTo?: string }>;
}) {
  const [{ imei }, sp, tz] = await Promise.all([params, searchParams, getDisplayTimezone()]);
  const today = new Date();
  const defaultTo = ymd(today, tz);
  const defaultFrom = ymd(new Date(today.getTime() - 6 * 86_400_000), tz);
  const validDate = (value?: string) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  let dateFrom = validDate(sp.dateFrom) ? sp.dateFrom! : defaultFrom;
  const dateTo = validDate(sp.dateTo) && sp.dateTo! <= defaultTo ? sp.dateTo! : defaultTo;
  if (dateFrom > dateTo) {
    dateFrom = ymd(new Date(Date.parse(`${dateTo}T00:00:00Z`) - 6 * 86_400_000), "UTC");
  } else if (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`) > 365 * 86_400_000) {
    dateFrom = ymd(new Date(Date.parse(`${dateTo}T00:00:00Z`) - 365 * 86_400_000), "UTC");
  }
  const [config, tenants, telemetry, ingredients, { machines: allMachines }] = await Promise.all([
    getMachineConfig(imei),
    getTenants(),
    getMachineDetail(imei, { from: dateFrom, to: dateTo, timeZone: tz }),
    getProducts(),
    getMachines(),
  ]);
  const menu = telemetry?.menu ?? { diy: [], unify: [] };
  const status = telemetry?.status ?? [];
  const media = telemetry?.media ?? [];
  const baseProduct = config?.baseProductId ? ingredients.find((p) => p.id === config.baseProductId) ?? null : null;
  const otherMachines = allMachines.filter((m) => m.device_imei !== imei).map((m) => ({ id: m.id, name: m.name }));
  const [pendingDraft, franchiseeAssignments, lotHistory, refillHistory, cleanHistory] = config?.machineId
    ? await Promise.all([
      getPendingMenuDraft(config.machineId),
      getFranchiseeAssignments(config.machineId),
      getMachineLotHistory(config.machineId, imei),
      getRefillHistory([config.machineId]),
      getMachineCleanHistory(config.machineId),
    ])
    : [null, [], [], [], []];
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
  const orderCoverageCurrent = telemetry?.orders_fresh_from && telemetry.orders_fresh_from <= dateFrom && telemetry.orders_fresh_through && telemetry.orders_fresh_through >= dateTo;
  const salesByDay = new Map<string, number>();
  for (const order of telemetry?.orders ?? []) {
    if (order.order_state === "COMPLETE" && !order.is_admin_override) {
      const day = ymd(new Date(order.order_time), tz);
      salesByDay.set(day, (salesByDay.get(day) ?? 0) + order.price);
    }
  }
  const dayCount = Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000) + 1;
  const salesData = Array.from({ length: dayCount }, (_, i) => {
    const day = new Date(Date.parse(`${dateFrom}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    return { label: day.slice(5), value: salesByDay.get(day) ?? 0 };
  });
  const completedSales = (telemetry?.orders ?? []).filter((order) => order.order_state === "COMPLETE" && !order.is_admin_override);
  const salesRevenue = completedSales.reduce((sum, order) => sum + order.price, 0);

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

      <p className="-mt-6 mb-6 text-xs text-taupe">
        Supabase snapshot · Machine data synced {telemetry?.machine_synced_at ? formatDateTime(telemetry.machine_synced_at, tz) : "never"}
      </p>

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
            <MachineConfigForm config={config} imei={imei} today={defaultTo} lastCleanDate={config.lastFullClean ? ymd(new Date(config.lastFullClean), tz) : ""} />
            {config.machineId && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="mb-3 text-[11px] uppercase tracking-wide text-taupe">Franchisee assignment &amp; profit share</h3>
                <FranchiseeAssignmentForm machineId={config.machineId} imei={imei} tenants={tenants} assignments={franchiseeAssignments} />
              </div>
            )}
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

      {config?.machineId && <MachineServiceQr machineId={config.machineId} machineName={name} />}

      {/* Cleaning history */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-cocoa">Cleaning history</h2>
          <span className="text-xs font-semibold text-taupe">Last full clean: {config?.lastFullClean ? formatDate(config.lastFullClean, tz) : "never recorded"}</span>
        </div>
        {cleanHistory.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-left text-[10px] uppercase text-taupe"><tr><th className="py-2">Date</th><th>Type</th><th>Material</th><th>Water</th><th>Recorded by</th><th>Odoo</th></tr></thead>
              <tbody className="divide-y divide-line">{cleanHistory.map((clean) => <tr key={clean.id}><td className="py-2 text-cocoa">{formatDateTime(clean.device_event_time, tz)}</td><td className="capitalize text-cocoa">{clean.kind}</td><td className="text-cocoa">{clean.cleaning_material_used === null ? "—" : clean.cleaning_material_used ? "Used" : "Not used"}</td><td className="text-cocoa">{clean.water_bucket_count === null ? "—" : `${clean.water_bucket_count} bucket${clean.water_bucket_count === 1 ? "" : "s"}`}</td><td className="text-taupe">{clean.operator_name ?? "Imported marker"}</td><td className="capitalize text-taupe">{clean.odoo_sync_status.replace("_", " ")}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-taupe">No cleaning events recorded yet. Setting “Last full clean” above creates the first history entry.</p>}
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
            <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Recent lot loads / usage</h3>
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
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Recent refills</h3>
          {refillHistory.length ? <div className="space-y-2">{refillHistory.map((refill) => (
            <div key={refill.id} className="rounded-lg bg-cream/50 px-3 py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-cocoa">{formatDateTime(refill.device_event_time, tz)}</span><span className="text-taupe">{refill.operator_name ?? "Unknown operator"} · Odoo: {refill.odoo_sync_status.replace("_", " ")}</span></div>
              <div className="mt-1 text-taupe">{refill.lines.length ? refill.lines.map((line) => `${line.lot_name} · ${line.quantity_used}${line.has_photo ? " · photo" : ""}`).join(" | ") : "No refill lines recorded"}</div>
            </div>
          ))}</div> : <p className="text-sm text-taupe">No refill events recorded for this machine.</p>}
        </div>
      </section>

      {/* Branding */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-1 font-display text-lg font-bold text-cocoa">Branding (machine screen)</h2>
        <p className="mb-3 text-xs text-taupe">Updates the display label, merchant, phone and language shown on the machine.</p>
        <DeviceBrandingForm imei={imei} />
      </section>

      {/* Monitored status */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-cocoa">Monitored status</h2>
          <span className="text-xs text-taupe">Observed {telemetry?.status_observed_at ? formatDateTime(telemetry.status_observed_at, tz) : "never"}</span>
        </div>
        {status.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[...status].sort((a, b) => statusDisplayRank(a) - statusDisplayRank(b) || translateStatusDesc(a.desc ?? a.code).localeCompare(translateStatusDesc(b.desc ?? b.code)) || String(a.code).localeCompare(String(b.code))).map((s, i) => {
              const desc = translateStatusDesc(s.desc ?? s.code).toLowerCase();
              const val = translateStatusValue(s.value);
              const resource = resourceStatusSignal(s);
              const fault = faultStatusSignal(s);
              const remaining = materialRemainingStatus(s);
              const online = s.code === "status_0_online_status";
              const isOnline = online && val.toLowerCase() === "online";
              let tone = "";
              if (desc.includes("formation ratio") || desc.includes("form") && desc.includes("ratio")) {
                const num = parseFloat(val);
                if (num === 0) tone = "text-danger font-bold";
                else if (num === 100) tone = "text-sage font-bold";
                else tone = "text-warning font-bold";
              }
              if (resource?.active) tone = resource.field === "material_empty" ? "text-warning font-bold" : "text-danger font-bold";
              if (fault?.active) tone = ["material_empty", "cup_take_fault"].includes(fault.field) ? "text-warning font-bold" : "text-danger font-bold";
              if (remaining) tone = remaining.level === "critical" ? "text-danger font-bold" : remaining.level === "warning" ? "text-warning font-bold" : "text-sage font-bold";
              if (online) tone = isOnline ? "text-sage font-bold" : "text-danger font-bold";
              const resourceName = resource?.field === "cup_empty" ? "Cup OOS" : "Low stock";
              const warningFault = fault?.active && ["material_empty", "cup_take_fault"].includes(fault.field);
              const danger = resource?.field === "cup_empty" && resource.active || fault?.active && !warningFault || remaining?.level === "critical" || online && !isOnline;
              const warning = resource?.field === "material_empty" && resource.active || warningFault || remaining?.level === "warning";
              const highlighted = danger ? "border-danger/40 bg-danger/10" : warning ? "border-warning/40 bg-warning/10" : online || remaining ? "border-sage/40 bg-sage/10" : "border-transparent bg-cream/50";
              const displayValue = remaining
                ? `${remaining.remainingCups === 0 ? "OOS · " : ""}${remaining.remainingCups} of ${remaining.totalCups} cups remaining (${remaining.remainingPct}%)`
                : resource?.active ? `${resourceName} active` : val;
              return (
                <div key={s.code ?? i} className={`rounded-lg border px-3 py-2 ${highlighted}`}>
                  <div className={`text-[10px] uppercase tracking-wide ${danger ? "font-bold text-danger" : warning ? "font-bold text-warning" : "text-taupe"}`}>{translateStatusDesc(s.desc ?? s.code)}</div>
                  <div className={`text-sm font-semibold ${tone || "text-cocoa"}`}>{displayValue}</div>
                  {resource?.active && <div className={`mt-0.5 text-[10px] ${resource.field === "material_empty" ? "text-warning" : "text-danger/80"}`}>Huaxin: {val}{s.data != null ? ` · signal ${s.data}` : ""}</div>}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-cocoa">Screen media (advertising)</h2>
          <span className="text-xs text-taupe">Synchronized {telemetry?.media_synced_at ? formatDateTime(telemetry.media_synced_at, tz) : "never"}</span>
        </div>
        <MediaManager imei={imei} media={media} />
      </section>

      {/* Product menu */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-cocoa">Synchronized product menu</h2>
            <p className="text-xs text-taupe">Last synchronized {telemetry?.menu_synced_at ? formatDateTime(telemetry.menu_synced_at, tz) : "never"}</p>
          </div>
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
                  <span className="ml-2 text-taupe">— values shown below are draft edits, not the synchronized snapshot.</span>
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
          <p className="text-sm text-taupe">No synchronized product menu is available.</p>
        )}
      </section>

      {/* Temperature */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-cocoa">Cylinder temperature</h2>
          {telemetry?.temperature_observed_at && (
            <span className="text-xs text-taupe">Observed {formatDateTime(telemetry.temperature_observed_at, tz)}</span>
          )}
        </div>
        {telemetry && telemetry.temperatures.length ? (
          <div className="mt-3">
            <LineChart data={telemetry.temperatures.map((t) => ({ label: new Date(t.time).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }), value: t.value }))} color="#6fa98c" height={180} unit="°C" zoomable dynamicScale />
          </div>
        ) : (
          <p className="mt-3 text-sm text-taupe">No temperature readings in the last 24 hours.</p>
        )}
      </section>

      {/* Orders */}
      <section id="sales" className="scroll-mt-4 rounded-2xl border border-line bg-white p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-display text-lg font-bold text-cocoa">Sales &amp; orders</h2><p className="mt-1 text-xs text-taupe">{completedSales.length} completed sales · €{salesRevenue.toFixed(2)}</p></div>
          <form action={`/machines/${imei}#sales`} className="flex flex-wrap items-end gap-2">
            <label><span className="mb-1 block text-[10px] uppercase text-taupe">From</span><input type="date" name="dateFrom" defaultValue={dateFrom} max={dateTo} className="rounded-lg border border-line px-2 py-1.5 text-sm text-cocoa" /></label>
            <label><span className="mb-1 block text-[10px] uppercase text-taupe">To</span><input type="date" name="dateTo" defaultValue={dateTo} min={dateFrom} max={defaultTo} className="rounded-lg border border-line px-2 py-1.5 text-sm text-cocoa" /></label>
            <button className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white">Apply</button>
          </form>
        </div>
        <p className={`mb-4 text-xs ${orderCoverageCurrent && telemetry?.orders_sync_status === "succeeded" ? "text-taupe" : "font-semibold text-warning"}`}>
          Supabase snapshot · Latest pull {telemetry?.orders_synced_at ? formatDateTime(telemetry.orders_synced_at, tz) : "never"}
          {orderCoverageCurrent ? ` · coverage ${telemetry?.orders_fresh_from} to ${telemetry?.orders_fresh_through}` : ` · selected range ${dateFrom} to ${dateTo} is not covered by a recorded successful pull`}
          {telemetry?.orders_sync_status && telemetry.orders_sync_status !== "succeeded" ? ` · latest attempt ${telemetry.orders_sync_status}` : ""}
        </p>
        <div className="mb-5 overflow-x-auto border-b border-line pb-5">
          <div style={{ minWidth: Math.max(600, salesData.length * 32) }}>
            <LineChart data={salesData} height={200} />
          </div>
        </div>
        <h3 className="mb-2 text-[11px] uppercase tracking-wide text-taupe">Latest 20 orders in selected range</h3>
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
          <p className="text-sm text-taupe">No orders in the selected date range.</p>
        )}
      </section>
    </div>
  );
}
