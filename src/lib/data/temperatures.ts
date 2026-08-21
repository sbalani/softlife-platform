import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { fleetFreshness } from "@/lib/data/fleet-freshness";
import type { TemperatureExplorerParams } from "@/lib/temperature-explorer";
import { TEMPERATURE_PAGE_SIZE } from "@/lib/temperature-explorer";

export type TempReading = {
  machine_id: string;
  machine_name: string;
  reading_time: string;
  series_name: string;
  value: number;
};

export type TemperatureSeriesOption = {
  machineId: string;
  machineName: string;
  seriesName: string;
};

export type HistoricalTemperature = {
  bucketStart: string;
  bucketEnd: string;
  value: number;
  minimum: number;
  maximum: number;
  samples: number;
};

export async function getTemperatureSeriesOptions(): Promise<{ options: TemperatureSeriesOption[]; error?: string }> {
  if (!isSupabaseConfigured()) return { options: [], error: "Supabase is not configured." };
  try {
    const supabase = await createClient();
    const options: TemperatureSeriesOption[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("v_latest_temps")
        .select("machine_id,machine_name,series_name")
        .order("machine_name")
        .order("series_name")
        .range(offset, offset + 999);
      if (error) throw error;
      for (const row of (data ?? []) as { machine_id: string; machine_name: string; series_name: string | null }[]) {
        if (row.series_name) options.push({ machineId: row.machine_id, machineName: row.machine_name, seriesName: row.series_name });
      }
      if (!data || data.length < 1000) break;
    }
    return { options };
  } catch (error) {
    return { options: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getHistoricalTemperatures(params: TemperatureExplorerParams): Promise<{
  rows: HistoricalTemperature[];
  total: number;
  error?: string;
}> {
  if (!isSupabaseConfigured()) return { rows: [], total: 0, error: "Supabase is not configured." };
  if (!params.machineId || !params.seriesName || params.errors.length) return { rows: [], total: 0 };
  try {
    const supabase = await createClient();
    const rpcParams = {
      p_machine_id: params.machineId,
      p_series_name: params.seriesName,
      p_start: params.start,
      p_end: params.end,
      p_detail: params.detail,
      p_filter: params.filterMode,
      p_lower: params.lowerThreshold,
      p_upper: params.upperThreshold,
      p_limit: TEMPERATURE_PAGE_SIZE,
      p_offset: (params.page - 1) * TEMPERATURE_PAGE_SIZE,
    };
    const { data, error } = await supabase.rpc("temperature_history", rpcParams);
    if (error) throw error;
    const rawRows = (data ?? []) as Record<string, unknown>[];
    let total = rawRows.length ? Number(rawRows[0].total_count) : 0;
    if (!rawRows.length && params.page > 1) {
      const { data: firstPage, error: countError } = await supabase.rpc("temperature_history", { ...rpcParams, p_limit: 1, p_offset: 0 });
      if (countError) throw countError;
      total = firstPage?.length ? Number((firstPage[0] as Record<string, unknown>).total_count) : 0;
    }
    return {
      rows: rawRows.map((row) => ({
        bucketStart: String(row.bucket_start),
        bucketEnd: String(row.bucket_end),
        value: Number(row.value_avg),
        minimum: Number(row.value_min),
        maximum: Number(row.value_max),
        samples: Number(row.samples),
      })),
      total,
    };
  } catch (error) {
    console.error("[temperatures] Historical read failed:", error);
    return { rows: [], total: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

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
