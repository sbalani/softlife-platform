import assert from "node:assert/strict";
import test from "node:test";
import { latestRecallRows } from "./recall.ts";

test("recall includes unresolved canonical lot observations", () => {
  const rows = latestRecallRows([], [{ machine_id: "machine-a", device_event_time: "2026-08-18T10:00:00Z" }], null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].machine_id, "machine-a");
});

test("recall preserves scope and latest-per-machine compatibility", () => {
  const rows = latestRecallRows(
    [{ machine_id: "machine-a", device_event_time: "2026-08-17T10:00:00Z" }],
    [{ machine_id: "machine-a", device_event_time: "2026-08-18T10:00:00Z" }, { machine_id: "machine-b", device_event_time: "2026-08-18T11:00:00Z" }],
    ["machine-a"],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].device_event_time, "2026-08-18T10:00:00Z");
});
