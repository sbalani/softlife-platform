import assert from "node:assert/strict";
import test from "node:test";
import { detectPasteurizationCycles, suggestedPasteurizationWindow } from "./pasteurization-pattern.ts";

const reading = (minutes: number, value: number, series_name = "Cylinder") => ({
  reading_time: new Date(Date.parse("2026-09-20T08:00:00Z") + minutes * 60_000).toISOString(), series_name, value,
});

test("detects one completed sustained pasteurization-shaped cycle", () => {
  const cycles = detectPasteurizationCycles([reading(0, 8), reading(10, 50), reading(40, 58), reading(70, 65), reading(90, 12)]);
  assert.deepEqual(cycles, [{
    seriesName: "cylinder", startedAt: "2026-09-20T08:10:00.000Z", endedAt: "2026-09-20T09:10:00.000Z",
    minimum: 50, maximum: 65, sampleCount: 3, durationMinutes: 60, maximumGapMinutes: 30,
  }]);
});

test("rejects incomplete, sparse, short, and overheated patterns", () => {
  assert.deepEqual(detectPasteurizationCycles([reading(0, 50), reading(30, 55), reading(60, 60)]), []);
  assert.deepEqual(detectPasteurizationCycles([reading(0, 50), reading(70, 55), reading(140, 60), reading(150, 10)]), []);
  assert.deepEqual(detectPasteurizationCycles([reading(0, 50), reading(15, 55), reading(30, 60), reading(35, 10)]), []);
  assert.deepEqual(detectPasteurizationCycles([reading(0, 50), reading(30, 66), reading(60, 60), reading(90, 10)]), []);
});

test("suggestions include safety margins and learn a one-to-three day recurrence", () => {
  const [first, second] = detectPasteurizationCycles([
    reading(-10, 10), reading(0, 50), reading(30, 55), reading(60, 60), reading(90, 10),
    reading(2 * 1440 - 10, 10),
    reading(2 * 1440, 50), reading(2 * 1440 + 30, 55), reading(2 * 1440 + 60, 60), reading(2 * 1440 + 90, 10),
  ]);
  assert.equal(suggestedPasteurizationWindow(first).intervalDays, 2);
  assert.deepEqual(suggestedPasteurizationWindow(second, first), {
    start: new Date("2026-09-22T07:30:00.000Z"), durationMinutes: 150, intervalDays: 2,
  });
});

test("requires a recent heat-up and tolerates an observed cooling transition", () => {
  assert.deepEqual(detectPasteurizationCycles([reading(0, 50), reading(30, 55), reading(60, 60), reading(90, 10)]), []);
  assert.equal(detectPasteurizationCycles([
    reading(0, 10), reading(20, 50), reading(50, 58), reading(80, 60), reading(95, 48), reading(110, 40),
  ]).length, 1);
  assert.deepEqual(detectPasteurizationCycles([
    reading(0, 10), reading(10, 50), reading(40, 58), reading(60, 66),
    reading(70, 50), reading(100, 58), reading(130, 60), reading(150, 40),
  ]), []);
});
