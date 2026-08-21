import assert from "node:assert/strict";
import test from "node:test";
import { matchesTemperatureFilter, parseTemperatureExplorerParams, temperatureBucketStart } from "./temperature-explorer.ts";

const NOW = new Date("2026-08-21T12:00:00.000Z");

test("temperature parameters validate presets, custom ranges, thresholds, and pages", () => {
  const preset = parseTemperatureExplorerParams({ period: "24h", filter: "at-or-above", lower: "5", page: "2" }, NOW);
  assert.equal(preset.start, "2026-08-20T12:00:00.000Z");
  assert.equal(preset.lowerThreshold, 5);
  assert.equal(preset.page, 2);
  assert.deepEqual(preset.errors, []);

  const invalid = parseTemperatureExplorerParams({
    period: "custom",
    from: "2026-08-22T00:00",
    to: "2026-08-21T00:00",
    filter: "outside-range",
    lower: "8",
    upper: "2",
    page: "0",
  }, NOW);
  assert.equal(invalid.page, 1);
  assert.equal(invalid.start, "2026-08-14T12:00:00.000Z");
  assert.ok(invalid.errors.some((error) => error.includes("start date")));
  assert.ok(invalid.errors.some((error) => error.includes("Outside range")));
});

test("temperature pagination preserves its snapshot and target selection", () => {
  const params = parseTemperatureExplorerParams({
    target: JSON.stringify(["123e4567-e89b-12d3-a456-426614174000", "Freezer"]),
    period: "24h",
    snapshot: "1",
    from: "2026-08-20T12:00:12.345Z",
    to: "2026-08-21T12:00:12.345Z",
    page: "2",
  }, new Date("2026-08-22T12:00:00.000Z"));
  assert.equal(params.machineId, "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(params.seriesName, "Freezer");
  assert.equal(params.start, "2026-08-20T12:00:12.345Z");
  assert.equal(params.end, "2026-08-21T12:00:12.345Z");
  assert.deepEqual(params.errors, []);
});

test("temperature buckets align to UTC boundaries", () => {
  assert.equal(temperatureBucketStart("2026-08-21T12:29:59.000Z", "15m"), "2026-08-21T12:15:00.000Z");
  assert.equal(temperatureBucketStart("2026-08-21T12:29:59.000Z", "1h"), "2026-08-21T12:00:00.000Z");
  assert.equal(temperatureBucketStart("2026-08-21T12:29:59.000Z", "1d"), "2026-08-21T00:00:00.000Z");
});

test("temperature filters include threshold equality and range anomalies", () => {
  assert.equal(matchesTemperatureFilter({ value: 5 }, "at-or-above", 5, null), true);
  assert.equal(matchesTemperatureFilter({ value: 5 }, "at-or-below", null, 5), true);
  assert.equal(matchesTemperatureFilter({ value: 4, minimum: 1, maximum: 7 }, "outside-range", 2, 6), true);
  assert.equal(matchesTemperatureFilter({ value: 4, minimum: 2, maximum: 6 }, "outside-range", 2, 6), false);
});
