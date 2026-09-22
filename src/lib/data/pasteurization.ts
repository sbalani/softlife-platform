import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { DEFAULT_TZ } from "@/lib/dates";
import { detectPasteurizationCycles, suggestedPasteurizationWindow, type PasteurizationCycle, type PasteurizationReading } from "@/lib/pasteurization-pattern";

export type PasteurizationSchedule = {
  id: string;
  machineId: string;
  machineName: string;
  seriesName: string | null;
  anchorDate: string;
  intervalDays: number;
  startLocal: string;
  durationMinutes: number;
  timeZone: string;
  enabled: boolean;
};

export type PasteurizationSuggestion = {
  id: string;
  machineId: string;
  machineName: string;
  seriesName: string;
  observedStart: string;
  observedEnd: string;
  minimumCelsius: number;
  maximumCelsius: number;
  sampleCount: number;
  maximumGapMinutes: number;
  suggestedAnchorDate: string;
  suggestedStartLocal: string;
  suggestedDurationMinutes: number;
  suggestedIntervalDays: number;
  timeZone: string;
};

function localParts(timestamp: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    time: `${values.get("hour")}:${values.get("minute")}:00`,
  };
}

export async function detectMachinePasteurizationPatterns(
  s: SupabaseClient,
  machineId: string,
  referenceTime = new Date().toISOString(),
  earliestInsertedTime = referenceTime,
  timeZone = DEFAULT_TZ,
) {
  const rows: PasteurizationReading[] = [];
  const reference = Date.parse(referenceTime);
  const earliestInserted = Date.parse(earliestInsertedTime);
  if (Number.isNaN(reference) || Number.isNaN(earliestInserted)) throw new Error("Invalid pasteurization detection reference time");
  const from = new Date(Math.max(reference - 7 * 86_400_000, earliestInserted - 12 * 3_600_000)).toISOString();
  const to = new Date(reference + 3_600_000).toISOString();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await s.from("huaxin_temperatures").select("id,reading_time,series_name,value")
      .eq("machine_id", machineId).gte("reading_time", from).lte("reading_time", to).order("reading_time").order("id").range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data as PasteurizationReading[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  const cycles = detectPasteurizationCycles(rows);
  const { data: priorSuggestions, error: priorError } = await s.from("pasteurization_window_suggestions")
    .select("series_name,observed_start,observed_end,minimum_celsius,maximum_celsius,sample_count,maximum_gap_minutes")
    .eq("machine_id", machineId).lt("observed_start", from).order("observed_start", { ascending: false }).limit(50);
  if (priorError) throw priorError;
  const previousBySeries = new Map<string, PasteurizationCycle>();
  for (const row of (priorSuggestions as Record<string, unknown>[]) ?? []) {
    const seriesName = String(row.series_name);
    if (!previousBySeries.has(seriesName)) previousBySeries.set(seriesName, {
      seriesName, startedAt: String(row.observed_start), endedAt: String(row.observed_end), minimum: Number(row.minimum_celsius),
      maximum: Number(row.maximum_celsius), sampleCount: Number(row.sample_count),
      durationMinutes: (Date.parse(String(row.observed_end)) - Date.parse(String(row.observed_start))) / 60_000,
      maximumGapMinutes: Number(row.maximum_gap_minutes),
    });
  }
  const suggestionRows: Record<string, unknown>[] = [];
  for (const cycle of cycles) {
    const suggestion = suggestedPasteurizationWindow(cycle, previousBySeries.get(cycle.seriesName));
    const local = localParts(suggestion.start.toISOString(), timeZone);
    suggestionRows.push({
      machine_id: machineId,
      series_name: cycle.seriesName,
      observed_start: cycle.startedAt,
      observed_end: cycle.endedAt,
      minimum_celsius: cycle.minimum,
      maximum_celsius: cycle.maximum,
      sample_count: cycle.sampleCount,
      maximum_gap_minutes: cycle.maximumGapMinutes,
      suggested_anchor_date: local.date,
      suggested_start_local: local.time,
      suggested_duration_minutes: suggestion.durationMinutes,
      suggested_interval_days: suggestion.intervalDays,
      time_zone: timeZone,
    });
    previousBySeries.set(cycle.seriesName, cycle);
  }
  if (!suggestionRows.length) return 0;
  const { error } = await s.from("pasteurization_window_suggestions").upsert(suggestionRows, {
    onConflict: "machine_id,series_name,observed_start", ignoreDuplicates: true,
  });
  if (error) throw error;
  return suggestionRows.length;
}

function relatedName(value: unknown) {
  const row = (Array.isArray(value) ? value[0] : value) as { display_name?: string | null; name?: string | null } | null;
  return row?.display_name || row?.name || "Unknown machine";
}

export async function getPasteurizationAlertSettings(): Promise<{ schedules: PasteurizationSchedule[]; suggestions: PasteurizationSuggestion[] }> {
  const s = await createServiceClient();
  const [scheduleResult, suggestionResult] = await Promise.all([
    s.from("machine_pasteurization_schedules").select("*,machines(name,display_name)").order("created_at", { ascending: false }),
    s.from("pasteurization_window_suggestions").select("*,machines(name,display_name)").eq("status", "pending").order("observed_start", { ascending: false }).limit(50),
  ]);
  if (scheduleResult.error) throw new Error(scheduleResult.error.message);
  if (suggestionResult.error) throw new Error(suggestionResult.error.message);
  return {
    schedules: ((scheduleResult.data as unknown as Record<string, unknown>[]) ?? []).map((row) => ({
      id: String(row.id), machineId: String(row.machine_id), machineName: relatedName(row.machines), seriesName: row.series_name as string | null,
      anchorDate: String(row.anchor_date), intervalDays: Number(row.interval_days), startLocal: String(row.start_local).slice(0, 5),
      durationMinutes: Number(row.duration_minutes), timeZone: String(row.time_zone), enabled: Boolean(row.enabled),
    })),
    suggestions: ((suggestionResult.data as unknown as Record<string, unknown>[]) ?? []).map((row) => ({
      id: String(row.id), machineId: String(row.machine_id), machineName: relatedName(row.machines), seriesName: String(row.series_name),
      observedStart: String(row.observed_start), observedEnd: String(row.observed_end), minimumCelsius: Number(row.minimum_celsius),
      maximumCelsius: Number(row.maximum_celsius), sampleCount: Number(row.sample_count), maximumGapMinutes: Number(row.maximum_gap_minutes),
      suggestedAnchorDate: String(row.suggested_anchor_date), suggestedStartLocal: String(row.suggested_start_local).slice(0, 5),
      suggestedDurationMinutes: Number(row.suggested_duration_minutes), suggestedIntervalDays: Number(row.suggested_interval_days),
      timeZone: String(row.time_zone),
    })),
  };
}
