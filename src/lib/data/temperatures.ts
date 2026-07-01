import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
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
    if (last) {
      out.push({
        machine_name: machineName,
        reading_time: category[category.length - 1] ?? new Date().toISOString(),
        series_name: series?.seriesname ?? "temperature",
        value: Number(last.value ?? 0),
      });
    }
  }
  return out;
}

export async function getLatestTemperatures(): Promise<{ temps: TempReading[]; source: Source }> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.from("v_latest_temps").select("*");
      if (!error && data && data.length) return { temps: data as TempReading[], source: "supabase" };
    } catch {
      /* fall through */
    }
  }
  try {
    const live = await getTempsLive();
    if (live.length) return { temps: live, source: "huaxin" };
  } catch (e) {
    console.error("[temps] Huaxin live failed:", e);
  }
  return { temps: SAMPLE, source: "sample" };
}
