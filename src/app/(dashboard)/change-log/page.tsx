import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { getChangeLog, type ChangeLogFilters } from "@/lib/data/change-log";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  machine_sync: "Machine sync",
  platform: "Platform",
  odoo: "Odoo",
};

const SOURCE_TONE: Record<string, string> = {
  machine_sync: "bg-sage/15 text-sage",
  platform: "bg-terracotta/15 text-terracotta",
  odoo: "bg-rose/15 text-rose",
};

function displayValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default async function ChangeLogPage({ searchParams }: { searchParams: Promise<ChangeLogFilters> }) {
  const filters = await searchParams;
  const [rows, tz] = await Promise.all([getChangeLog(await createServiceClient(), filters), getDisplayTimezone()]);
  const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
  const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-cocoa">Change Log</h1>
        <p className="mt-1 text-sm text-taupe">Machine syncs, pulled differences, platform pushes, and ingredient changes. Showing the latest {rows.length} records.</p>
      </header>

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label><span className={label}>From</span><input name="dateFrom" type="date" defaultValue={filters.dateFrom} className={input} /></label>
        <label><span className={label}>To</span><input name="dateTo" type="date" defaultValue={filters.dateTo} className={input} /></label>
        <label><span className={label}>Machine</span><input name="machine" defaultValue={filters.machine} placeholder="Name or IMEI" className={`w-44 ${input}`} /></label>
        <label><span className={label}>Source</span><select name="source" defaultValue={filters.source ?? ""} className={input}><option value="">All</option><option value="machine_sync">Machine sync</option><option value="platform">Platform</option><option value="odoo">Odoo</option></select></label>
        <label><span className={label}>Field</span><input name="field" defaultValue={filters.field} placeholder="price, sku, image…" className={`w-44 ${input}`} /></label>
        <button className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90">Filter</button>
        <Link href="/change-log" className="text-sm font-semibold text-terracotta hover:underline">Clear</Link>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Machine / item</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Field</th><th className="px-4 py-3">Before</th><th className="px-4 py-3">After</th><th className="px-4 py-3">By</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const productName = typeof row.metadata?.product_name === "string" ? row.metadata.product_name : null;
              const before = displayValue(row.old_value);
              const after = displayValue(row.new_value);
              return (
                <tr key={row.id} className="align-top hover:bg-cream/50">
                  <td className="whitespace-nowrap px-4 py-3 text-cocoa">{formatDateTime(row.created_at, tz)}</td>
                  <td className="px-4 py-3"><div className="font-semibold text-cocoa">{row.machine_name ?? productName ?? row.entity_type}</div><div className="font-mono text-[10px] text-taupe">{row.device_imei ?? row.entity_key ?? "—"}{row.device_imei && row.entity_key ? ` · ${row.entity_key}` : ""}</div></td>
                  <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_TONE[row.source] ?? "bg-cream text-taupe"}`}>{SOURCE_LABEL[row.source] ?? row.source}</span><div className="mt-1 text-[10px] text-taupe">{row.action.replaceAll("_", " ")}</div></td>
                  <td className="px-4 py-3 font-semibold text-cocoa">{row.field ?? "—"}</td>
                  <td className="max-w-64 break-all px-4 py-3 text-taupe" title={before}>{before}</td>
                  <td className="max-w-64 break-all px-4 py-3 text-cocoa" title={after}>{after}</td>
                  <td className="px-4 py-3 text-xs text-taupe">{row.actor_email ?? (row.source === "machine_sync" ? "Sync" : "System")}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-taupe">No changes match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
