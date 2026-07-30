const DAY_MS = 86_400_000;

export function addCouponDays(date: string, days: number): string {
  if (!date || !Number.isFinite(days)) return "";
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function couponDaysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS));
}
