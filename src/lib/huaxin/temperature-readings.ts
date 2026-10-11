import { DEFAULT_TZ, localDateTimeToUtc } from "../dates.ts";

const BARE_TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})$/;
const LOCAL_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;
const OFFSET_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;

function nextDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid temperature anchor date");
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function parseHuaxinTemperatureValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function normalizeHuaxinTimestamps(
  labels: Array<string | undefined>,
  anchorDate: string,
  options: { timeZone?: string; latestAllowed?: Date } = {},
): Array<string | null> {
  const timeZone = options.timeZone ?? DEFAULT_TZ;
  const latestAllowed = options.latestAllowed ?? new Date(Date.now() + 5 * 60_000);
  let bareDate = anchorDate;
  let previousBareSeconds: number | null = null;

  return labels.map((input) => {
    const raw = input?.trim();
    if (!raw) return null;
    try {
      let iso: string;
      const bare = raw.match(BARE_TIME_RE);
      if (bare) {
        const hour = Number(bare[1]);
        const minute = Number(bare[2]);
        const second = Number(bare[3]);
        if (hour > 23 || minute > 59 || second > 59) return null;
        const seconds = hour * 3600 + minute * 60 + second;
        if (previousBareSeconds !== null && seconds < previousBareSeconds) bareDate = nextDate(bareDate);
        previousBareSeconds = seconds;
        iso = localDateTimeToUtc(`${bareDate}T${String(hour).padStart(2, "0")}:${bare[2]}:${bare[3]}`, timeZone);
      } else {
        const local = raw.match(LOCAL_DATE_TIME_RE);
        if (local) iso = localDateTimeToUtc(`${local[1]}T${local[2]}`, timeZone);
        else if (OFFSET_DATE_TIME_RE.test(raw)) iso = new Date(raw).toISOString();
        else return null;
      }
      const instant = new Date(iso);
      return Number.isFinite(instant.getTime()) && instant <= latestAllowed ? instant.toISOString() : null;
    } catch {
      return null;
    }
  });
}
