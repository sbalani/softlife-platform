import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, listDevices, pullTemperatures } from "@/lib/huaxin/client";
import type { Source } from "./machines";

export type TempReading = {
  machine_name: string;
  reading_time: string;
  series_name: string;
  value: number;
};

const SAMPLE: TempReading[] = [
  { machine_name: "B84MAX-001", reading_time: "2026-07-01T09:00:00Z", series_name: "Cylinder", value: -4.2 },
  { machine_name: "B84MAX-002", reading_time: "2026-07-01T09:00:00Z", series_name: "Cylinder", value: -3.8 },
  { machine_name: "B84MAX-003", reading_time: "2026-07-01T08:45:00Z", series_name: "Hopper", value: -2.1 },
];

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Huaxin's temperature chart-label is sometimes a bare time-of-day
 *  ("23:56:46", no date at all) and sometimes space-separated
 *  ("YYYY-MM-DD HH:mm:ss") — neither parses with `new Date()` directly
 *  (renders "Invalid Date"). Normalize to a parseable ISO-ish string at the
 *  source instead of at every call site. `anchorDate` (YYYY-MM-DD) is used
 *  when the label has no date component — it's the date the reading batch
 *  was queried for, the best available anchor for a bare time-of-day. */
function normalizeHuaxinTimestamp(raw: string | undefined, anchorDate: string): string {
  if (!raw) return new Date().toISOString();
  if (raw.includes("T")) return raw;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) return `${anchorDate}T${raw}`;
  return raw.replace(" ", "T");
}

async function getTempsLive(): Promise<TempReading[]> {
  const cfg = getConfigFromEnv();
  if (!cfg) return [];
  const devices = await listDevices(cfg);
  const began = ymd(new Date(Date.now() - 24 * 3600 * 1000));
  const end = ymd(new Date());
  const out: TempReading[] = [];
  for (const d of devices) {
    if (!d.deviceImei) continue;
    const machineName = (d.deviceLabel as string) || d.deviceName || d.deviceImei;
    const t = await pullTemperatures(cfg, d.deviceImei, began, end);
    const series = (t.dataset ?? [])[0];
    const data = series?.data ?? [];
    const category = t.category ?? [];
    const last = data[data.length - 1];
    if (last && last.value != null) {
      out.push({
        machine_name: machineName,
        reading_time: normalizeHuaxinTimestamp(category[category.length - 1]?.label, end),
        series_name: series?.seriesname ?? "temperature",
        value: Number(last.value),
      });
    }
  }
  return out;
}

export async function getLatestTemperatures(): Promise<{ temps: TempReading[]; source: Source }> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServiceClient();
      const { data, error } = await supabase.from("v_latest_temps").select("*");
      // Filter out rows with no reading (left join yields null value for machines without temps).
      const rows = ((data as TempReading[]) ?? []).filter((t) => t.value != null);
      if (!error && rows.length) return { temps: rows, source: "supabase" };
    } catch {
      /* fall through */
    }
  }
  if (getConfigFromEnv()) {
    try {
      return { temps: await getTempsLive(), source: "huaxin" };
    } catch (e) {
      console.error("[temps] Huaxin live failed:", e);
      return { temps: [], source: "huaxin" };
    }
  }
  return { temps: SAMPLE, source: "sample" };
}
