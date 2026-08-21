export const TEMPERATURE_PAGE_SIZE = 250;

export type TemperatureDetail = "raw" | "15m" | "1h" | "1d";
export type TemperatureFilterMode = "all" | "outside-range" | "at-or-above" | "at-or-below";
export type TemperaturePeriod = "24h" | "7d" | "30d" | "90d" | "1y" | "custom";

export type TemperatureExplorerParams = {
  machineId: string | null;
  seriesName: string | null;
  period: TemperaturePeriod;
  start: string;
  end: string;
  detail: TemperatureDetail;
  filterMode: TemperatureFilterMode;
  lowerThreshold: number | null;
  upperThreshold: number | null;
  page: number;
  errors: string[];
};

type SearchValue = string | string[] | undefined;
type SearchParams = Record<string, SearchValue>;
type FilterValues = { value: number; minimum?: number; maximum?: number };

const PERIOD_MS: Record<Exclude<TemperaturePeriod, "custom">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
};

const BUCKET_MS: Record<Exclude<TemperatureDetail, "raw">, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

function one(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function finiteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUtcInput(value: string | undefined): Date | null {
  if (!value) return null;
  const localUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value);
  const preciseUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value);
  if (!localUtc && !preciseUtc) return null;
  const parsed = new Date(localUtc ? `${value}Z` : value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function parseTemperatureExplorerParams(raw: SearchParams, now = new Date()): TemperatureExplorerParams {
  const errors: string[] = [];
  const pageValue = Number(one(raw.page) ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue >= 1 && pageValue <= 100_000 ? pageValue : 1;
  if (page !== pageValue) errors.push("Invalid page; showing page 1.");
  const periodValue = one(raw.period) ?? "7d";
  const period: TemperaturePeriod = ["24h", "7d", "30d", "90d", "1y", "custom"].includes(periodValue)
    ? periodValue as TemperaturePeriod
    : "7d";
  if (period !== periodValue) errors.push("Unknown period; showing 7 days.");

  let end = now;
  let start = new Date(now.getTime() - PERIOD_MS[period === "custom" ? "7d" : period]);
  if (period === "custom" || one(raw.snapshot) === "1") {
    const customStart = parseUtcInput(one(raw.from));
    const customEnd = parseUtcInput(one(raw.to));
    if (!customStart || !customEnd) {
      errors.push("The selected time window must contain valid UTC date-times.");
    } else if (customStart >= customEnd) {
      errors.push("The start date must be before the end date.");
    } else if (customEnd.getTime() - customStart.getTime() > 366 * 24 * 60 * 60 * 1000) {
      errors.push("Custom ranges cannot exceed 366 days.");
    } else {
      start = customStart;
      end = customEnd;
    }
  }

  const detailValue = one(raw.detail) ?? "1h";
  const detail: TemperatureDetail = ["raw", "15m", "1h", "1d"].includes(detailValue) ? detailValue as TemperatureDetail : "1h";
  if (detail !== detailValue) errors.push("Unknown detail level; showing hourly buckets.");

  const filterValue = one(raw.filter) ?? "all";
  const filterMode: TemperatureFilterMode = ["all", "outside-range", "at-or-above", "at-or-below"].includes(filterValue)
    ? filterValue as TemperatureFilterMode
    : "all";
  if (filterMode !== filterValue) errors.push("Unknown filter; showing all readings.");

  const lowerRaw = one(raw.lower);
  const upperRaw = one(raw.upper);
  const lowerThreshold = finiteNumber(lowerRaw);
  const upperThreshold = finiteNumber(upperRaw);
  if (lowerRaw?.trim() && lowerThreshold === null) errors.push("The lower threshold must be a number.");
  if (upperRaw?.trim() && upperThreshold === null) errors.push("The upper threshold must be a number.");
  if (filterMode === "outside-range" && (lowerThreshold === null || upperThreshold === null || lowerThreshold >= upperThreshold)) {
    errors.push("Outside range requires a lower threshold smaller than the upper threshold.");
  }
  if (filterMode === "at-or-above" && lowerThreshold === null) errors.push("At or above requires a lower threshold.");
  if (filterMode === "at-or-below" && upperThreshold === null) errors.push("At or below requires an upper threshold.");

  let targetMachine: string | undefined;
  let targetSeries: string | undefined;
  const target = one(raw.target);
  if (target) {
    try {
      const parsedTarget = JSON.parse(target) as unknown;
      if (Array.isArray(parsedTarget) && parsedTarget.length === 2 && parsedTarget.every((value) => typeof value === "string")) {
        [targetMachine, targetSeries] = parsedTarget;
      } else {
        errors.push("Invalid machine and series selection.");
      }
    } catch {
      errors.push("Invalid machine and series selection.");
    }
  }
  const machineId = targetMachine?.trim() || one(raw.machine)?.trim() || null;
  if (machineId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(machineId)) {
    errors.push("Invalid machine selection.");
  }
  const seriesName = targetSeries?.trim() || one(raw.series)?.trim() || null;
  if (seriesName && seriesName.length > 200) errors.push("Invalid temperature series.");

  return {
    machineId,
    seriesName,
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    detail,
    filterMode,
    lowerThreshold,
    upperThreshold,
    page,
    errors,
  };
}

export function temperatureBucketStart(timestamp: string, detail: TemperatureDetail): string {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) throw new Error("Invalid temperature timestamp");
  if (detail === "raw") return new Date(time).toISOString();
  return new Date(Math.floor(time / BUCKET_MS[detail]) * BUCKET_MS[detail]).toISOString();
}

export function matchesTemperatureFilter(values: FilterValues, mode: TemperatureFilterMode, lower: number | null, upper: number | null): boolean {
  if (mode === "all") return true;
  if (mode === "at-or-above") return lower !== null && values.value >= lower;
  if (mode === "at-or-below") return upper !== null && values.value <= upper;
  return lower !== null && upper !== null && ((values.minimum ?? values.value) < lower || (values.maximum ?? values.value) > upper);
}
