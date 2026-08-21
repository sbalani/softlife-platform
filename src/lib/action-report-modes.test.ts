import assert from "node:assert/strict";
import test from "node:test";
import { legacyKindFromModes, modesFromLegacyKind, parseActionReportModes } from "./action-report-modes.ts";

test("legacy action kinds normalize to independent modes", () => {
  assert.deepEqual(modesFromLegacyKind("both"), ["cleaning", "refill"]);
  assert.deepEqual(parseActionReportModes(undefined, "refill"), ["refill"]);
});

test("refill and other remain one valid report while duplicates and unknown modes fail", () => {
  assert.deepEqual(parseActionReportModes(["other", "refill"]), ["refill", "other"]);
  assert.equal(legacyKindFromModes(["refill", "other"]), "refill");
  assert.equal(parseActionReportModes(["refill", "refill"]), null);
  assert.equal(parseActionReportModes(["repair"]), null);
  assert.equal(parseActionReportModes([]), null);
});
