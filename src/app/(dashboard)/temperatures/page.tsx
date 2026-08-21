import Link from "next/link";
import { redirect } from "next/navigation";
import { LineChart } from "@/components/LineChart";
import { getSessionProfile } from "@/lib/auth/session";
import { getHistoricalTemperatures, getTemperatureSeriesOptions } from "@/lib/data/temperatures";
import { formatDateTime } from "@/lib/dates";
import {
  matchesTemperatureFilter,
  parseTemperatureExplorerParams,
  TEMPERATURE_PAGE_SIZE,
  type TemperatureExplorerParams,
  type TemperaturePeriod,
} from "@/lib/temperature-explorer";
import { getDisplayTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const inputClass = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa outline-none focus:border-terracotta";
const periods: { value: TemperaturePeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "1 year" },
  { value: "custom", label: "Custom" },
];

function utcInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}

function explorerHref(params: TemperatureExplorerParams, updates: Partial<{ period: TemperaturePeriod; page: number }>): string {
  const query = new URLSearchParams({
    machine: params.machineId ?? "",
    series: params.seriesName ?? "",
    period: updates.period ?? params.period,
    from: params.start,
    to: params.end,
    detail: params.detail,
    filter: params.filterMode,
    lower: params.lowerThreshold?.toString() ?? "",
    upper: params.upperThreshold?.toString() ?? "",
    page: String(updates.page ?? 1),
  });
  if (updates.page !== undefined) query.set("snapshot", "1");
  return `/temperatures?${query}`;
}

export default async function TemperaturesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") redirect("/refills");

  const parsed = parseTemperatureExplorerParams(await searchParams);
  const [{ options, error: optionError }, tz] = await Promise.all([getTemperatureSeriesOptions(), getDisplayTimezone()]);
  const firstOption = options.find((option) => option.machineId === parsed.machineId) ?? options[0];
  const params: TemperatureExplorerParams = {
    ...parsed,
    machineId: parsed.machineId ?? firstOption?.machineId ?? null,
    seriesName: parsed.seriesName ?? firstOption?.seriesName ?? null,
  };
  const selectedExists = !params.machineId || !params.seriesName || options.some((option) => option.machineId === params.machineId && option.seriesName === params.seriesName);
  if (!selectedExists) params.errors.push("That machine and temperature series combination is unavailable.");

  const { rows, total, error: historyError } = await getHistoricalTemperatures(params);
  const machineOptions = [...new Map(options.map((option) => [option.machineId, option.machineName])).entries()];
  const selectedMachine = machineOptions.find(([id]) => id === params.machineId)?.[1] ?? "Unknown machine";
  const pageCount = Math.max(1, Math.ceil(total / TEMPERATURE_PAGE_SIZE));
  if (params.page > pageCount) redirect(explorerHref(params, { page: pageCount }));
  const chartRows = [...rows].reverse();
  const sampleCount = rows.reduce((sum, row) => sum + row.samples, 0);

  return (
    <div>
      <header className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-terracotta">HACCP history</p>
          <h1 className="font-display text-3xl font-bold text-cocoa">Temperature explorer</h1>
          <p className="mt-1 text-sm text-taupe">Auditable machine telemetry, bucketed and bounded for historical review.</p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Quick periods">
          {periods.filter((period) => period.value !== "custom").map((period) => (
            <Link
              key={period.value}
              href={explorerHref(params, { period: period.value })}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${params.period === period.value ? "border-terracotta bg-terracotta text-white" : "border-line bg-white text-cocoa hover:border-terracotta"}`}
            >
              {period.label}
            </Link>
          ))}
        </div>
      </header>

      <form className="mb-6 rounded-2xl border border-line bg-sand/35 p-4" method="get">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-bold uppercase tracking-wide text-taupe md:col-span-2">
            Machine / series
            <select name="target" defaultValue={params.machineId && params.seriesName ? JSON.stringify([params.machineId, params.seriesName]) : ""} className={inputClass}>
              {options.length === 0 && <option value="">No machines with readings</option>}
              {options.map((option) => <option key={`${option.machineId}:${option.seriesName}`} value={JSON.stringify([option.machineId, option.seriesName])}>{option.machineName} · {option.seriesName}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-taupe">
            Period
            <select name="period" defaultValue={params.period} className={inputClass}>
              {periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-taupe">
            Detail
            <select name="detail" defaultValue={params.detail} className={inputClass}>
              <option value="raw">Raw readings</option>
              <option value="15m">15 minute</option>
              <option value="1h">Hourly</option>
              <option value="1d">Daily</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-taupe">
            From (UTC)
            <input type="datetime-local" name="from" defaultValue={utcInput(params.start)} className={inputClass} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-taupe">
            To (UTC, exclusive)
            <input type="datetime-local" name="to" defaultValue={utcInput(params.end)} className={inputClass} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-taupe">
            Filter
            <select name="filter" defaultValue={params.filterMode} className={inputClass}>
              <option value="all">All readings</option>
              <option value="outside-range">Outside range</option>
              <option value="at-or-above">At or above (hide below)</option>
              <option value="at-or-below">At or below (hide above)</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold uppercase tracking-wide text-taupe">
              Lower °C
              <input type="number" step="any" name="lower" defaultValue={params.lowerThreshold ?? ""} placeholder="e.g. 5" className={inputClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-taupe">
              Upper °C
              <input type="number" step="any" name="upper" defaultValue={params.upperThreshold ?? ""} placeholder="e.g. 8" className={inputClass} />
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-col justify-between gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
          <p className="text-xs text-taupe">For example, “at or above” with lower 5 hides every bucket below 5°C. Outside-range checks each bucket’s minimum and maximum.</p>
          <button type="submit" className="rounded-lg bg-terracotta px-5 py-2 text-sm font-bold text-white hover:opacity-90">Apply</button>
        </div>
      </form>

      {(optionError || historyError || params.errors.length > 0) && (
        <div className="mb-6 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {[optionError, historyError, ...params.errors].filter(Boolean).join(" ")}
        </div>
      )}

      {options.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">No temperature readings are available yet.</div>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-line bg-white p-4"><p className="text-xs uppercase tracking-wide text-taupe">Buckets on page</p><p className="mt-1 font-display text-2xl font-bold text-cocoa">{rows.length}</p></div>
            <div className="rounded-xl border border-line bg-white p-4"><p className="text-xs uppercase tracking-wide text-taupe">Raw samples</p><p className="mt-1 font-display text-2xl font-bold text-cocoa">{sampleCount.toLocaleString()}</p></div>
            <div className="rounded-xl border border-line bg-white p-4"><p className="text-xs uppercase tracking-wide text-taupe">Page minimum</p><p className="mt-1 font-display text-2xl font-bold text-sage">{rows.length ? `${Math.min(...rows.map((row) => row.minimum)).toFixed(1)}°C` : "—"}</p></div>
            <div className="rounded-xl border border-line bg-white p-4"><p className="text-xs uppercase tracking-wide text-taupe">Page maximum</p><p className="mt-1 font-display text-2xl font-bold text-terracotta">{rows.length ? `${Math.max(...rows.map((row) => row.maximum)).toFixed(1)}°C` : "—"}</p></div>
          </section>

          <section className="mb-6 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="mb-4 flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
              <div><h2 className="font-display text-lg font-bold text-cocoa">{selectedMachine} · {params.seriesName}</h2><p className="text-xs text-taupe">Page {params.page} of {pageCount}; at most {TEMPERATURE_PAGE_SIZE} points are rendered.</p></div>
              <p className="text-xs text-taupe">{formatDateTime(params.start, tz)} to {formatDateTime(params.end, tz)}</p>
            </div>
            <LineChart
              data={chartRows.map((row) => ({
                label: new Date(row.bucketStart).toLocaleString("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
                value: row.value,
              }))}
              color="#d47e54"
              height={280}
              unit="°C"
              zoomable
              dynamicScale
            />
          </section>

          <section>
            <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div><h2 className="font-display text-lg font-bold text-cocoa">Historical log</h2><p className="text-xs text-taupe">{total.toLocaleString()} matching bucket{total === 1 ? "" : "s"}; newest first. Times display in {tz}.</p></div>
              <div className="flex gap-2">
                {params.page > 1 && <Link href={explorerHref(params, { page: params.page - 1 })} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa hover:border-terracotta">Previous</Link>}
                {params.page < pageCount && <Link href={explorerHref(params, { page: params.page + 1 })} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa hover:border-terracotta">Next</Link>}
              </div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-line bg-sand/40 text-left text-[11px] uppercase tracking-wide text-taupe"><th className="px-4 py-3">Period start</th><th className="px-4 py-3 text-right">Average</th><th className="px-4 py-3 text-right">Minimum</th><th className="px-4 py-3 text-right">Maximum</th><th className="px-4 py-3 text-right">Samples</th><th className="px-4 py-3">Result</th></tr></thead>
                <tbody>
                  {rows.map((row) => {
                    const matched = params.filterMode !== "all" && matchesTemperatureFilter(row, params.filterMode, params.lowerThreshold, params.upperThreshold);
                    return (
                      <tr key={row.bucketStart} className="border-b border-line/70 last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-cocoa">{formatDateTime(row.bucketStart, tz)}</td>
                        <td className="px-4 py-3 text-right font-bold text-cocoa">{row.value.toFixed(2)}°C</td>
                        <td className="px-4 py-3 text-right text-taupe">{row.minimum.toFixed(2)}°C</td>
                        <td className="px-4 py-3 text-right text-taupe">{row.maximum.toFixed(2)}°C</td>
                        <td className="px-4 py-3 text-right text-taupe">{row.samples.toLocaleString()}</td>
                        <td className={`px-4 py-3 text-xs font-bold uppercase tracking-wide ${matched ? "text-danger" : "text-sage"}`}>{matched ? "Filter match" : "Recorded"}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-taupe">No readings match this machine, period, detail, and filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
