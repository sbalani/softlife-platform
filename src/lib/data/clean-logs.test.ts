import assert from "node:assert/strict";
import test from "node:test";
import { cleanDay } from "./service-history-utils.ts";

test("cleaning dates compare by calendar day", () => {
  assert.equal(cleanDay("2026-08-01T12:00:00Z"), "2026-08-01");
  assert.equal(cleanDay("2026-07-31T22:30:00Z"), "2026-08-01");
  assert.equal(cleanDay(null), "");
});
