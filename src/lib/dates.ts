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
