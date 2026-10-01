import { ymd } from "./dates.ts";
import { PAYOUT_TIME_ZONE } from "./payout-report.ts";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPayoutMonth(value: string): boolean {
  return MONTH.test(value);
}

function shiftMonth(value: string, amount: number): string {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return shifted.toISOString().slice(0, 7);
}

export function payoutMonthRange(requestedMonth?: string, now = new Date()) {
  const currentMonth = ymd(now, PAYOUT_TIME_ZONE).slice(0, 7);
  const fallback = shiftMonth(currentMonth, -1);
  const month = requestedMonth && isPayoutMonth(requestedMonth) && requestedMonth <= currentMonth ? requestedMonth : fallback;
  const from = `${month}-01`;
  const nextMonth = shiftMonth(month, 1);
  const to = new Date(Date.parse(`${nextMonth}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const label = new Date(`${from}T12:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  return { month, from, to, label, currentMonth };
}
