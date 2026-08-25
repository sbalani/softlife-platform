import assert from "node:assert/strict";
import test from "node:test";
import { refillAge } from "./refill-aging.ts";

const now = Date.parse("2026-08-25T12:00:00.000Z");

test("refill aging leaves machines without history unaged", () => {
  assert.deepEqual(refillAge(null, now), { state: "never", days: null });
});

test("refill aging becomes due at one week and overdue after two weeks", () => {
  assert.equal(refillAge("2026-08-19T12:00:00.000Z", now).state, "fresh");
  assert.deepEqual(refillAge("2026-08-18T12:00:00.000Z", now), { state: "due", days: 7 });
  assert.equal(refillAge("2026-08-11T12:00:00.000Z", now).state, "due");
  assert.deepEqual(refillAge("2026-08-11T11:59:59.000Z", now), { state: "overdue", days: 14 });
});
