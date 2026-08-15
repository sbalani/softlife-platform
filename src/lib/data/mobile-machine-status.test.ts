import assert from "node:assert/strict";
import test from "node:test";
import { presentMachineStatuses, type MachineStatusSnapshot } from "./mobile-machine-status.ts";

const observedAt = "2026-08-15T10:00:00.000Z";
const row = (code: string, value: string, observed_at = observedAt): MachineStatusSnapshot => ({ field: `raw:${code}`, raw: { code, value }, observed_at });

test("mobile statuses are ordered, translated, and deduplicated", () => {
  const result = presentMachineStatuses([
    row("unknown", "value"),
    row("status_0_online_status", "online"),
    row("status_0_lackmaterial", "Normal"),
    row("status_0_online_status", "offline", "2026-08-15T10:05:00.000Z"),
  ], Date.parse("2026-08-15T11:00:00.000Z"));
  assert.deepEqual(result.statuses.map(({ code }) => code), ["status_0_lackmaterial", "status_0_online_status", "unknown"]);
  assert.equal(result.statuses[0].label, "Material Shortage Status");
  assert.equal(result.statuses[1].value, "Offline");
  assert.equal(result.status_observed_at, "2026-08-15T10:05:00.000Z");
  assert.equal(result.status_stale, false);
});

test("mobile status freshness is stale only after two hours", () => {
  assert.equal(presentMachineStatuses([row("status_0_online_status", "online")], Date.parse("2026-08-15T12:00:00.000Z")).status_stale, false);
  assert.equal(presentMachineStatuses([row("status_0_online_status", "online")], Date.parse("2026-08-15T12:00:00.001Z")).status_stale, true);
  assert.deepEqual(presentMachineStatuses([], Date.now()), { statuses: [], status_observed_at: null, status_stale: true });
});
