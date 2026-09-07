export const DEFAULT_TZ = "Europe/Madrid";

export const COMMON_TZ = [
  "Europe/Madrid",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Shanghai",
  "UTC",
];

export function tzAbbrev(tz: string): string {
  return new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? tz;
}

function parseDate(iso: string): Date {
  return new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
}

export function formatDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return parseDate(iso).toLocaleString("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatDate(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return parseDate(iso).toLocaleDateString("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ymd(d: Date, tz = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

export function toIso(s: string | null | undefined): string | null {
  if (!s) return null;
  return parseDate(s).toISOString();
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function localDateTimeToUtc(value: string, timeZone: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error("Local date-time must use YYYY-MM-DDTHH:mm[:ss]");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { throw new Error("Invalid IANA time zone"); }
  const desired = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0) };
  const desiredEpoch = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second);
  let candidate = new Date(desiredEpoch);
  for (let attempt = 0; attempt < 4; attempt++) {
    const actual = zonedParts(candidate, timeZone);
    const actualEpoch = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate = new Date(candidate.getTime() + desiredEpoch - actualEpoch);
  }
  const final = zonedParts(candidate, timeZone);
  if (Object.entries(desired).some(([key, expected]) => final[key as keyof typeof final] !== expected)) throw new Error("Local date-time does not exist in the selected time zone");
  return candidate.toISOString();
}

export function isoToLocalDateTime(value: string, timeZone: string): string {
  const parts = zonedParts(new Date(value), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}
