import { DEFAULT_TZ, localDateTimeToUtc, ymd } from "./dates.ts";

const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validMonth(value: string | undefined): value is string {
  if (!value || !MONTH.test(value)) return false;
  return new Date(`${value}-01T00:00:00Z`).toISOString().slice(0, 7) === value;
}

function validDay(value: string | undefined): value is string {
  if (!value || !DAY.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

export function actionReportCalendarState(requestedMonth: string | undefined, requestedDay: string | undefined, now = new Date()) {
  const today = ymd(now, DEFAULT_TZ);
  const selectedDay = validDay(requestedDay) && requestedDay <= today ? requestedDay : null;
  const month = validMonth(requestedMonth) ? requestedMonth : selectedDay?.slice(0, 7) ?? today.slice(0, 7);
  const nextMonth = shiftMonth(month, 1);
  return {
    month,
    previousMonth: shiftMonth(month, -1),
    nextMonth,
    today,
    selectedDay,
    rangeFrom: localDateTimeToUtc(`${month}-01T00:00`, DEFAULT_TZ),
    rangeTo: localDateTimeToUtc(`${nextMonth}-01T00:00`, DEFAULT_TZ),
    initialEventTime: selectedDay === today ? now.toISOString() : selectedDay ? localDateTimeToUtc(`${selectedDay}T12:00`, DEFAULT_TZ) : now.toISOString(),
  };
}
