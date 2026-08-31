import assert from "node:assert/strict";
import test from "node:test";
import { parseMachineRefreshClaim, presentRefreshComponents, runRefreshComponents } from "./huaxin-machine-refresh.ts";

test("reports full and partial component refresh outcomes with persisted freshness", async () => {
  const times = [new Date("2026-08-31T10:00:00Z"), new Date("2026-08-31T10:00:05Z")];
  const full = await runRefreshComponents({
    refreshStatus: async () => undefined,
    refreshMenu: async () => undefined,
    readFreshness: async () => ({ statusObservedAt: "2026-08-31T10:00:04Z", menuSyncedAt: "2026-08-31T10:00:03Z" }),
    now: () => times.shift()!,
  });
  assert.equal(full.ok, true);
  assert.equal(full.partial, false);
  assert.equal(full.refresh.status.outcome, "succeeded");
  assert.equal(full.refresh.status.freshness, "fresh");
  assert.equal(full.refresh.menu.outcome, "succeeded");

  const partial = await runRefreshComponents({
    refreshStatus: async () => undefined,
    refreshMenu: async () => { throw new Error("upstream details"); },
    readFreshness: async () => ({ statusObservedAt: "2026-08-31T10:00:04Z", menuSyncedAt: null }),
    now: () => new Date("2026-08-31T10:00:05Z"),
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.partial, true);
  assert.equal(partial.refresh.menu.outcome, "failed");
  assert.equal(partial.refresh.menu.error?.message, "Menu refresh failed");
  assert.equal(JSON.stringify(partial).includes("upstream details"), false);
});

test("reports a failed refresh only when both components fail", async () => {
  const result = await runRefreshComponents({
    refreshStatus: async () => { throw new Error("status"); },
    refreshMenu: async () => { throw new Error("menu"); },
    readFreshness: async () => ({ statusObservedAt: null, menuSyncedAt: null }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.partial, false);
  assert.equal(result.refresh.status.outcome, "failed");
  assert.equal(result.refresh.menu.outcome, "failed");
});

test("preserves component outcomes when the final freshness read fails", async () => {
  const result = await runRefreshComponents({
    refreshStatus: async () => undefined,
    refreshMenu: async () => undefined,
    readFreshness: async () => { throw new Error("database read failed"); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.refresh.status.outcome, "succeeded");
  assert.equal(result.refresh.status.freshness, "missing");
  assert.equal(result.refresh.menu.outcome, "succeeded");
});

test("presents stale and skipped component snapshots without claiming a refresh", () => {
  const components = presentRefreshComponents({ status: "skipped", menu: "skipped" }, {
    statusObservedAt: "2026-08-31T07:00:00Z",
    menuSyncedAt: "2026-08-29T07:00:00Z",
  }, Date.parse("2026-08-31T10:00:00Z"));
  assert.equal(components.status.freshness, "stale");
  assert.equal(components.menu.freshness, "stale");
  assert.equal(components.status.outcome, "skipped");
});

test("parses claim rows and rejects malformed lock responses", () => {
  assert.deepEqual(parseMachineRefreshClaim([{ claimed: false, reason: "cooldown", retry_after_seconds: 42 }]), { claimed: false, reason: "cooldown", retry_after_seconds: 42 });
  assert.throws(() => parseMachineRefreshClaim([{ claimed: false, reason: "unknown" }]));
});
