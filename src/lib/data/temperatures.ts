import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { fleetFreshness } from "@/lib/data/fleet-freshness";

export type TempReading = {
  machine_id: string;
  machine_name: string;
  reading_time: string;
  series_name: string;
  value: number;
};

/** Huaxin's temperature chart-label is sometimes a bare time-of-day
 *  ("23:56:46", no date at all) and sometimes space-separated
 *  ("YYYY-MM-DD HH:mm:ss"). */
export function normalizeHuaxinTimestamp(raw: string | undefined, anchorDate: string): string {
  if (!raw) return new Date().toISOString();
  if (raw.includes("T")) return raw;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) return `${anchorDate}T${raw}`;
  return raw.replace(" ", "T");
}

export async function getLatestTemperatures(): Promise<{
  temps: TempReading[];
  source: "supabase";
  latestReadingAt: string | null;
  staleReadings: number;
  readError?: string;
}> {
  if (!isSupabaseConfigured()) return { temps: [], source: "supabase", latestReadingAt: null, staleReadings: 0, readError: "Supabase is not configured." };
  try {
    const s = await createServiceClient();
    const temps: TempReading[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await s.from("v_latest_temps").select("*").order("machine_name").order("machine_id").order("series_name").range(offset, offset + 999);
      if (error) throw error;
      temps.push(...((data as TempReading[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    const freshness = fleetFreshness(temps.map((temp) => temp.reading_time));
    return {
      temps,
      source: "supabase",
      latestReadingAt: freshness.latest,
      staleReadings: freshness.stale,
    };
  } catch (error) {
    console.error("[temperatures] Supabase read failed:", error);
    return { temps: [], source: "supabase", latestReadingAt: null, staleReadings: 0, readError: error instanceof Error ? error.message : String(error) };
  }
}
