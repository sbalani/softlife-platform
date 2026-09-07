import test from "node:test";
import assert from "node:assert/strict";
import { actionReportCalendarState } from "./action-report-calendar.ts";
import { isoToLocalDateTime, localDateTimeToUtc } from "./dates.ts";

test("calendar month boundaries follow Madrid daylight saving time", () => {
  const state = actionReportCalendarState("2026-03", undefined, new Date("2026-03-15T10:00:00Z"));
  assert.equal(state.rangeFrom, "2026-02-28T23:00:00.000Z");
  assert.equal(state.rangeTo, "2026-03-31T22:00:00.000Z");
  assert.equal(state.previousMonth, "2026-02");
  assert.equal(state.nextMonth, "2026-04");
});

test("calendar accepts past dates and rejects future dates", () => {
  const now = new Date("2026-09-07T08:30:00Z");
  assert.equal(actionReportCalendarState(undefined, "2026-09-06", now).initialEventTime, "2026-09-06T10:00:00.000Z");
  assert.equal(actionReportCalendarState(undefined, "2026-09-08", now).selectedDay, null);
});

test("Action Report form date-times stay in Madrid and reject the DST gap", () => {
  assert.equal(isoToLocalDateTime("2026-07-15T10:30:00Z", "Europe/Madrid"), "2026-07-15T12:30");
  assert.throws(() => localDateTimeToUtc("2026-03-29T02:30", "Europe/Madrid"), /does not exist/);
});
