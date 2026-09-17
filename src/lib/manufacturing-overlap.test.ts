import assert from "node:assert/strict";
import test from "node:test";
import { manufacturingOverlapGuidance } from "./manufacturing-overlap.ts";

test("completed overlap explains the inclusive period and next start date", () => {
  assert.equal(manufacturingOverlapGuidance({
    periodFrom: "2026-08-31T22:00:00.000Z",
    periodTo: "2026-09-15T22:00:00.000Z",
    timeZone: "Europe/Madrid",
    status: "completed",
  }), "These orders were already completed in a manufacturing run covering 1 Sept 2026 through 15 Sept 2026. To avoid duplicates, start the next run from 2026-09-16.");
});

test("unconfirmed overlap describes the orders as reserved", () => {
  assert.match(manufacturingOverlapGuidance({
    periodFrom: "2026-09-01T22:00:00.000Z",
    periodTo: "2026-09-02T22:00:00.000Z",
    timeZone: "Europe/Madrid",
    status: "blocked",
  }) ?? "", /^These orders are reserved/);
});
