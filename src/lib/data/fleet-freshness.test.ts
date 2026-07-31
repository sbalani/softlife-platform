import assert from "node:assert/strict";
import test from "node:test";
import { fleetFreshness } from "./fleet-freshness.ts";

test("fleet freshness counts stale and missing snapshots", () => {
  const now = Date.parse("2026-07-31T12:00:00Z");
  assert.deepEqual(fleetFreshness(["2026-07-31T11:00:00Z", "2026-07-30T08:00:00Z", null], now), {
    latest: "2026-07-31T11:00:00Z",
    stale: 2,
  });
});
