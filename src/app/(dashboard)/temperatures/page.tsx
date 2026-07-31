import { getLatestTemperatures } from "@/lib/data/temperatures";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

function tempColor(v: number) {
  if (v > 5 || v < -10) return "text-danger";
  if (v > 0 || v < -7) return "text-warning";
  return "text-sage";
}

export default async function TemperaturesPage() {
  const { temps, latestReadingAt, staleReadings, readError } = await getLatestTemperatures();
  const tz = await getDisplayTimezone();
  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Temperatures</h1>
        <p className="mt-1 text-sm text-taupe">Latest reading per machine and series (HACCP)</p>
      </header>

      <p className={`mb-4 text-xs ${readError ? "font-semibold text-danger" : staleReadings ? "font-semibold text-warning" : "text-taupe"}`}>
        {readError ? `Supabase temperature read failed: ${readError}` : `Supabase snapshot · Latest observation ${latestReadingAt ? formatDateTime(latestReadingAt, tz) : "never"}${staleReadings ? ` · ${staleReadings} reading(s) are older than 26 hours` : ""}`}
      </p>

      {temps.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">
          No temperature readings yet. Sync a machine that reports temperatures to see HACCP logs here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {temps.map((t) => {
            const v = t.value;
            return (
              <article key={`${t.machine_id}:${t.series_name}`} className="rounded-2xl border border-line bg-white p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-cocoa">{t.machine_name}</h2>
                  <span className="text-[11px] uppercase tracking-wide text-taupe">{t.series_name ?? "temp"}</span>
                </div>
                <div className={`mt-2 font-display text-4xl font-bold ${tempColor(v)}`}>
                  {v.toFixed(1)}°C
                </div>
                <p className="mt-1 text-xs text-taupe">
                  {formatDateTime(t.reading_time, tz)}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
