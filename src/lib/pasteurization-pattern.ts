export type PasteurizationReading = {
  id?: string;
  reading_time: string;
  series_name: string | null;
  value: number;
};

export type PasteurizationCycle = {
  seriesName: string;
  startedAt: string;
  endedAt: string;
  minimum: number;
  maximum: number;
  sampleCount: number;
  durationMinutes: number;
  maximumGapMinutes: number;
};

export const PASTEURIZATION_PATTERN = {
  minimumCelsius: 50,
  maximumCelsius: 65,
  completionBelowCelsius: 45,
  minimumDurationMinutes: 45,
  maximumDurationMinutes: 8 * 60,
  maximumGapMinutes: 60,
  minimumSamples: 3,
  maximumHeatUpMinutes: 180,
} as const;

export function normalizePasteurizationSeries(value: string | null | undefined) {
  const raw = value?.trim() || "temperature";
  const compact = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return compact.includes("precool") || compact.includes("preenfri") ? "pre-cooling" : raw.toLowerCase();
}

export function detectPasteurizationCycles(readings: PasteurizationReading[]): PasteurizationCycle[] {
  const bySeries = new Map<string, PasteurizationReading[]>();
  for (const reading of readings) {
    if (!Number.isFinite(reading.value) || Number.isNaN(Date.parse(reading.reading_time))) continue;
    const series = normalizePasteurizationSeries(reading.series_name);
    bySeries.set(series, [...(bySeries.get(series) ?? []), reading]);
  }

  const cycles: PasteurizationCycle[] = [];
  for (const [seriesName, seriesReadings] of bySeries) {
    const ordered = [...seriesReadings].sort((a, b) => Date.parse(a.reading_time) - Date.parse(b.reading_time) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
    let active: PasteurizationReading[] = [];
    let maximumGapMinutes = 0;
    let lastColdAt: number | null = null;

    const finish = (completed: boolean) => {
      if (completed && active.length >= PASTEURIZATION_PATTERN.minimumSamples) {
        const started = Date.parse(active[0].reading_time);
        const ended = Date.parse(active.at(-1)!.reading_time);
        const durationMinutes = (ended - started) / 60_000;
        if (durationMinutes >= PASTEURIZATION_PATTERN.minimumDurationMinutes && durationMinutes <= PASTEURIZATION_PATTERN.maximumDurationMinutes) {
          cycles.push({
            seriesName,
            startedAt: new Date(started).toISOString(),
            endedAt: new Date(ended).toISOString(),
            minimum: Math.min(...active.map((row) => row.value)),
            maximum: Math.max(...active.map((row) => row.value)),
            sampleCount: active.length,
            durationMinutes,
            maximumGapMinutes,
          });
        }
      }
      active = [];
      maximumGapMinutes = 0;
    };

    for (const reading of ordered) {
      const inBand = reading.value >= PASTEURIZATION_PATTERN.minimumCelsius && reading.value <= PASTEURIZATION_PATTERN.maximumCelsius;
      if (inBand) {
        if (active.length) {
          const gap = (Date.parse(reading.reading_time) - Date.parse(active.at(-1)!.reading_time)) / 60_000;
          if (gap <= 0 || gap > PASTEURIZATION_PATTERN.maximumGapMinutes) finish(false);
          else maximumGapMinutes = Math.max(maximumGapMinutes, gap);
        }
        if (active.length || (lastColdAt !== null && (Date.parse(reading.reading_time) - lastColdAt) / 60_000 <= PASTEURIZATION_PATTERN.maximumHeatUpMinutes)) active.push(reading);
        continue;
      }
      if (reading.value < PASTEURIZATION_PATTERN.completionBelowCelsius) {
        finish(active.length > 0);
        lastColdAt = Date.parse(reading.reading_time);
      } else if (reading.value > PASTEURIZATION_PATTERN.maximumCelsius) {
        finish(false);
        lastColdAt = null;
      } else if (active.length && (Date.parse(reading.reading_time) - Date.parse(active[0].reading_time)) / 60_000 > PASTEURIZATION_PATTERN.maximumDurationMinutes) {
        finish(false);
      }
    }
  }
  return cycles.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.seriesName.localeCompare(b.seriesName));
}

export function suggestedPasteurizationWindow(cycle: PasteurizationCycle, previousCycle?: PasteurizationCycle) {
  const start = new Date(Date.parse(cycle.startedAt) - 30 * 60_000);
  const observedWithMargins = cycle.durationMinutes + 90;
  const durationMinutes = Math.min(12 * 60, Math.max(120, Math.ceil(observedWithMargins / 15) * 15));
  const interval = previousCycle ? Math.round((Date.parse(cycle.startedAt) - Date.parse(previousCycle.startedAt)) / 86_400_000) : 2;
  return { start, durationMinutes, intervalDays: interval >= 1 && interval <= 3 ? interval : 2 };
}
