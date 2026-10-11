import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHuaxinTimestamps, parseHuaxinTemperatureValue } from "./temperature-readings.ts";

test("temperature values reject blanks instead of converting them to zero", () => {
  assert.equal(parseHuaxinTemperatureValue(""), null);
  assert.equal(parseHuaxinTemperatureValue("  "), null);
  assert.equal(parseHuaxinTemperatureValue(null), null);
  assert.equal(parseHuaxinTemperatureValue("0"), 0);
  assert.equal(parseHuaxinTemperatureValue("4.25"), 4.25);
});

test("bare Huaxin times use the source timezone and roll over at midnight", () => {
  assert.deepEqual(normalizeHuaxinTimestamps(["23:55:00", "00:05:00"], "2026-10-10", {
    timeZone: "Europe/Madrid",
    latestAllowed: new Date("2026-10-12T00:00:00Z"),
  }), ["2026-10-10T21:55:00.000Z", "2026-10-10T22:05:00.000Z"]);
});

test("timestamps reject blanks, invalid dates, and future observations", () => {
  assert.deepEqual(normalizeHuaxinTimestamps([
    "",
    "2026-02-30 12:00:00",
    "2026-10-11T10:00:00Z",
    "2026-10-11T13:00:00Z",
  ], "2026-10-11", { latestAllowed: new Date("2026-10-11T12:00:00Z") }), [
    null,
    null,
    "2026-10-11T10:00:00.000Z",
    null,
  ]);
});
