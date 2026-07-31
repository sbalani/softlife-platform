import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv } from "@/lib/huaxin/client";
import { SyncButton } from "./SyncButton";
import { TimezoneSelector } from "./TimezoneSelector";
import { ApiKeyManager } from "./ApiKeyManager";
import { listApiKeys } from "./api-key-actions";
import { formatDateTime, tzAbbrev } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getVatRates } from "@/lib/data/franchisee-profit";
import { VatRateManager } from "./VatRateManager";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

async function count(table: string): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const s = await createServiceClient();
    const { count } = await s.from(table).select("*", { count: "exact", head: true });
    return count;
  } catch {
    return null;
  }
}

function Stat({ label, v }: { label: string; v: ReactNode }) {
  return (
    <div className="rounded-xl bg-cream p-3">
      <div className="text-[11px] uppercase tracking-wide text-taupe">{label}</div>
      <div className="font-display text-2xl font-bold text-cocoa">{v ?? "—"}</div>
    </div>
  );
}

type LatestOrderRun = {
  id: string;
  status: string;
  trigger_source: string;
  requested_from: string;
  requested_to: string;
  finished_at: string | null;
  machines_total: number;
  machines_succeeded: number;
  machines_failed: number;
  orders_fetched: number;
  error: string | null;
};

type OrderMachineResult = { device_imei: string; machine_name: string | null; error: string | null };

export default async function SettingsPage() {
  const cfg = getConfigFromEnv();
  const tz = await getDisplayTimezone();
  const [machines, temps, orders, faults, apiKeys, vatRates] = await Promise.all([
    count("machines"),
    count("huaxin_temperatures"),
    count("huaxin_orders"),
    count("huaxin_faults"),
    listApiKeys(),
    getVatRates(),
  ]);

  let lastSync: string | null = null;
  let latestOrderRun: LatestOrderRun | null = null;
  let failedOrderMachines: OrderMachineResult[] = [];
  if (isSupabaseConfigured()) {
    try {
      const s = await createServiceClient();
      const { data } = await s
        .from("machines")
        .select("huaxin_last_sync")
        .order("huaxin_last_sync", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      lastSync = (data as { huaxin_last_sync?: string } | null)?.huaxin_last_sync ?? null;
      const { data: orderRun } = await s
        .from("order_sync_runs")
        .select("id,status,trigger_source,requested_from,requested_to,finished_at,machines_total,machines_succeeded,machines_failed,orders_fetched,error")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      latestOrderRun = orderRun as LatestOrderRun | null;
      if (latestOrderRun?.machines_failed) {
        const { data: machineResults } = await s
          .from("order_sync_machine_results")
          .select("device_imei,machine_name,error")
          .eq("run_id", latestOrderRun.id)
          .eq("status", "failed");
        failedOrderMachines = (machineResults as OrderMachineResult[]) ?? [];
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Settings</h1>
        <p className="mt-1 text-sm text-taupe">Huaxin sync &amp; connection</p>
      </header>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Huaxin sync</h2>
        <p className="mt-1 mb-4 max-w-2xl text-sm text-taupe">
          Pulls machines, temperature readings and orders from the Huaxin cloud into Supabase.
          Use this until the Huaxin engineer configures the webhook (notify_url) for real-time data.
        </p>
        <SyncButton />
        <div className="mt-3 text-xs text-taupe">
          Last machine metadata sync: {lastSync ? formatDateTime(lastSync, tz) : "never"}
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Order sync health</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Status" v={latestOrderRun?.status.toUpperCase() ?? "—"} />
          <Stat label="Machines succeeded" v={latestOrderRun?.machines_succeeded ?? null} />
          <Stat label="Machines failed" v={latestOrderRun?.machines_failed ?? null} />
          <Stat label="Orders fetched" v={latestOrderRun?.orders_fetched ?? null} />
        </div>
        <div className="mt-3 text-xs text-taupe">
          {latestOrderRun ? `${latestOrderRun.status.toUpperCase()} · ${latestOrderRun.trigger_source} · ${latestOrderRun.requested_from} to ${latestOrderRun.requested_to} · finished ${latestOrderRun.finished_at ? formatDateTime(latestOrderRun.finished_at, tz) : "in progress"}` : "No order sync has run yet."}
        </div>
        {failedOrderMachines.length > 0 && (
          <div className="mt-4 rounded-xl bg-cream p-3 text-xs text-danger">
            {failedOrderMachines.map((machine) => (
              <div key={machine.device_imei}><span className="font-semibold">{machine.machine_name || machine.device_imei}</span>: {machine.error}</div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Display timezone</h2>
        <p className="mt-1 mb-3 text-sm text-taupe">
          All dates and times across the dashboard are shown in this timezone. Currently {tzAbbrev(tz)}.
        </p>
        <TimezoneSelector current={tz} />
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">VAT schedule</h2>
        <p className="mt-1 mb-4 max-w-2xl text-sm text-taupe">VAT is removed from VAT-inclusive sales before calculating franchisee profit share.</p>
        <VatRateManager rates={vatRates} />
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">MCP API keys</h2>
        <p className="mt-1 mb-4 max-w-2xl text-sm text-taupe">
          Generate per-user keys to connect ChatGPT, Claude, or other AI tools to your SoftLife data.
          Endpoint: <code className="rounded bg-cream px-1 text-xs">https://awsfqnymosevmhawbukf.supabase.co/functions/v1/softlife-mcp?key=YOUR_KEY</code>
        </p>
        <ApiKeyManager keys={apiKeys} />
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Connection</h2>
        <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-taupe">Huaxin host</dt>
            <dd className="font-semibold text-cocoa">{cfg ? cfg.baseUrl : "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-taupe">Verify SSL</dt>
            <dd className="font-semibold text-cocoa">
              {cfg ? (cfg.verifySsl ? "On" : "Off (UAT)") : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-taupe">Supabase</dt>
            <dd className="font-semibold text-cocoa">
              {isSupabaseConfigured() ? "Connected" : "Not configured"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Cached data</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Machines" v={machines} />
          <Stat label="Temperatures" v={temps} />
          <Stat label="Orders" v={orders} />
          <Stat label="Faults" v={faults} />
        </div>
      </section>
    </div>
  );
}
