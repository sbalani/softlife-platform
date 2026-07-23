import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv } from "@/lib/huaxin/client";
import { SyncButton } from "./SyncButton";
import { TimezoneSelector } from "./TimezoneSelector";
import { formatDateTime, tzAbbrev } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";

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

function Stat({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="rounded-xl bg-cream p-3">
      <div className="text-[11px] uppercase tracking-wide text-taupe">{label}</div>
      <div className="font-display text-2xl font-bold text-cocoa">{v ?? "—"}</div>
    </div>
  );
}

export default async function SettingsPage() {
  const cfg = getConfigFromEnv();
  const tz = await getDisplayTimezone();
  const [machines, temps, orders, faults] = await Promise.all([
    count("machines"),
    count("huaxin_temperatures"),
    count("huaxin_orders"),
    count("huaxin_faults"),
  ]);

  let lastSync: string | null = null;
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
          Last sync: {lastSync ? formatDateTime(lastSync, tz) : "never"}
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-cocoa">Display timezone</h2>
        <p className="mt-1 mb-3 text-sm text-taupe">
          All dates and times across the dashboard are shown in this timezone. Currently {tzAbbrev(tz)}.
        </p>
        <TimezoneSelector current={tz} />
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
