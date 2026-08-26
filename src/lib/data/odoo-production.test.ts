import assert from "node:assert/strict";
import test from "node:test";
import { OdooContractError, parsePeriodInput } from "./odoo-production.ts";

test("period requests freeze exact UTC boundaries and a deterministic fingerprint", () => {
  const input = parsePeriodInput({
    idempotency_key: "odoo-db:august", local_from: "2026-08-01T00:00:00", local_to: "2026-09-01T00:00:00",
    time_zone: "Europe/Madrid", initiated_by: "odoo",
  });
  assert.equal(input.periodFrom, "2026-07-31T22:00:00.000Z");
  assert.equal(input.periodTo, "2026-08-31T22:00:00.000Z");
  assert.equal(input.documentDate, "2026-08-31");
  assert.equal(input.fingerprint.length, 64);
});

test("period requests reject missing keys and backwards ranges", () => {
  assert.throws(() => parsePeriodInput({ local_from: "2026-08-01T00:00", local_to: "2026-08-02T00:00", time_zone: "UTC" }), OdooContractError);
  assert.throws(() => parsePeriodInput({ idempotency_key: "x", local_from: "2026-08-02T00:00", local_to: "2026-08-01T00:00", time_zone: "UTC", initiated_by: "odoo" }), /after/);
});
