import assert from "node:assert/strict";
import test from "node:test";
import { isPayoutMonth, payoutMonthRange } from "./payouts.ts";

test("payout month defaults to the previous complete Madrid month", () => {
  assert.deepEqual(payoutMonthRange(undefined, new Date("2026-10-01T10:00:00Z")), {
    month: "2026-09",
    from: "2026-09-01",
    to: "2026-09-30",
    label: "September 2026",
    currentMonth: "2026-10",
  });
});

test("payout month includes leap day and permits the current month", () => {
  assert.equal(payoutMonthRange("2024-02", new Date("2024-03-10T10:00:00Z")).to, "2024-02-29");
  assert.equal(payoutMonthRange("2024-03", new Date("2024-03-10T10:00:00Z")).month, "2024-03");
});

test("payout month rejects malformed and future values", () => {
  assert.equal(isPayoutMonth("2026-13"), false);
  assert.equal(isPayoutMonth("2026-9"), false);
  assert.equal(payoutMonthRange("2026-11", new Date("2026-10-01T10:00:00Z")).month, "2026-09");
});
