import assert from "node:assert/strict";
import test from "node:test";
import { finiteTemperaturePoints, temperatureTickIndexes } from "./temperature-chart.ts";

test("temperature chart normalizes ranges and drops non-finite points", () => {
  assert.deepEqual(finiteTemperaturePoints([
    { label: "a", value: 4, minimum: 5, maximum: 3 },
    { label: "b", value: Number.NaN, minimum: 1, maximum: 2 },
  ]), [{ label: "a", value: 4, minimum: 3, maximum: 5 }]);
});

test("temperature ticks include both ends at the requested density", () => {
  assert.deepEqual(temperatureTickIndexes(10, 4), [0, 3, 6, 9]);
  assert.deepEqual(temperatureTickIndexes(1, 8), [0]);
});
